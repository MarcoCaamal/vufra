//! Reusable running headers/footers for flow documents.
//! Render after pagination so {{page}} and {{total}} know the final page count.
//! Bands reuse the exact native row renderer; no browser, fake fonts or rasterized text.
use crate::{
    PageGeometry, PdfRow, RenderError, check_cancel, rich_text::FontRegistry, row::PdfRowItem,
};
use krilla::{surface::Surface, text::Font};
use parley::{FontContext, LayoutContext};
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone, Default)]
pub struct PdfPageChrome {
    pub header: Option<PdfRow>,
    pub footer: Option<PdfRow>,
    pub first_header: Option<PdfRow>,
    pub first_footer: Option<PdfRow>,
    pub odd_header: Option<PdfRow>,
    pub even_header: Option<PdfRow>,
    pub odd_footer: Option<PdfRow>,
    pub even_footer: Option<PdfRow>,
    pub hide_odd_header: bool,
    pub hide_even_header: bool,
    pub hide_odd_footer: bool,
    pub hide_even_footer: bool,
    pub hide_header: bool,
    pub hide_footer: bool,
    pub hide_first_header: bool,
    pub hide_first_footer: bool,
}

impl PdfPageChrome {
    /// Select by one-based printed page parity after first-page overrides.
    /// Per-parity alternatives override base bands, including base suppression.
    fn band(&self, index: usize, header: bool) -> Option<&PdfRow> {
        if index == 0 {
            if (header && self.hide_first_header) || (!header && self.hide_first_footer) {
                return None;
            }
            let special = if header {
                &self.first_header
            } else {
                &self.first_footer
            };
            if special.is_some() {
                return special.as_ref();
            }
        }
        let odd = index.is_multiple_of(2);
        let hidden = match (odd, header) {
            (true, true) => self.hide_odd_header,
            (false, true) => self.hide_even_header,
            (true, false) => self.hide_odd_footer,
            (false, false) => self.hide_even_footer,
        };
        if hidden {
            return None;
        }
        let alternative = match (odd, header) {
            (true, true) => &self.odd_header,
            (false, true) => &self.even_header,
            (true, false) => &self.odd_footer,
            (false, false) => &self.even_footer,
        };
        if alternative.is_some() {
            return alternative.as_ref();
        }
        if (header && self.hide_header) || (!header && self.hide_footer) {
            return None;
        }
        if header {
            self.header.as_ref()
        } else {
            self.footer.as_ref()
        }
    }
    fn hidden_on_page(&self, index: usize, header: bool) -> bool {
        if index == 0 {
            if (header && self.hide_first_header) || (!header && self.hide_first_footer) {
                return true;
            }
            if (header && self.first_header.is_some()) || (!header && self.first_footer.is_some()) {
                return false;
            }
        }
        let odd = index.is_multiple_of(2);
        let (hidden, defined) = match (odd, header) {
            (true, true) => (self.hide_odd_header, self.odd_header.is_some()),
            (false, true) => (self.hide_even_header, self.even_header.is_some()),
            (true, false) => (self.hide_odd_footer, self.odd_footer.is_some()),
            (false, false) => (self.hide_even_footer, self.even_footer.is_some()),
        };
        if hidden {
            return true;
        }
        if defined {
            return false;
        }
        if header {
            self.hide_header
        } else {
            self.hide_footer
        }
    }
    pub(crate) fn should_draw_default_header(&self, page: usize) -> bool {
        !self.hidden_on_page(page, true) && self.band(page, true).is_none()
    }
    pub(crate) fn should_draw_default_footer(&self, page: usize) -> bool {
        !self.hidden_on_page(page, false) && self.band(page, false).is_none()
    }
    fn substitute(source: &str, page: usize, total: usize) -> String {
        source
            .replace("{{page}}", &page.to_string())
            .replace("{{total}}", &total.to_string())
    }
    fn on_page(row: &PdfRow, page: usize, total: usize) -> PdfRow {
        let mut row = row.clone();
        for col in &mut row.columns {
            for item in &mut col.items {
                match item {
                    PdfRowItem::Text { text, .. } => {
                        *text = Self::substitute(text, page, total);
                    }
                    PdfRowItem::RichText { runs, .. } => {
                        for run in runs {
                            run.text = Self::substitute(&run.text, page, total);
                        }
                    }
                    _ => {}
                }
            }
        }
        row
    }
    /// Measure all variants before paginating the document and reserve enough
    /// body-free space for the largest header/footer. A long page count is
    /// represented by conservative eight-digit sentinels for line wrapping.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn reserve(
        &self,
        mut geom: PageGeometry,
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
    ) -> Result<PageGeometry, RenderError> {
        let mut top = geom.margin_top;
        let mut bottom = geom.margin_bottom;
        for header in [true, false] {
            let variants = [
                &self.header,
                &self.footer,
                &self.first_header,
                &self.first_footer,
                &self.odd_header,
                &self.even_header,
                &self.odd_footer,
                &self.even_footer,
            ];
            let selected: Vec<&PdfRow> = if header {
                [0, 2, 4, 5]
                    .into_iter()
                    .filter_map(|i| variants[i].as_ref())
                    .collect()
            } else {
                [1, 3, 6, 7]
                    .into_iter()
                    .filter_map(|i| variants[i].as_ref())
                    .collect()
            };
            for row in selected {
                check_cancel(cancel)?;
                let resolved = Self::on_page(row, 99_999_999, 99_999_999);
                let measured = resolved.prepare(
                    (geom.content_width(), geom.height - 24.0),
                    family,
                    fonts,
                    context,
                    registry,
                    cancel,
                )?;
                if header {
                    top = top.max(measured.height + 16.0);
                } else {
                    bottom = bottom.max(measured.height + 16.0);
                }
            }
        }
        geom.margin_top = top;
        geom.margin_bottom = bottom;
        geom.validate()?;
        Ok(geom)
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn draw(
        &self,
        index: usize,
        total: usize,
        geom: PageGeometry,
        surface: &mut Surface,
        font: &Font,
        family: &str,
        fonts: &mut FontContext,
        context: &mut LayoutContext<()>,
        registry: &mut FontRegistry,
        cancel: &AtomicBool,
    ) -> Result<(), RenderError> {
        for is_header in [true, false] {
            check_cancel(cancel)?;
            let Some(band) = self.band(index, is_header) else {
                continue;
            };
            let resolved = Self::on_page(band, index + 1, total);
            let available_height = if is_header {
                geom.margin_top
            } else {
                geom.margin_bottom
            };
            let safe_height = available_height - 16.0;
            if safe_height < 16.0 {
                return Err(RenderError::InvalidInput(
                    "page margin is too small for chrome",
                ));
            }
            let measured = resolved.prepare(
                (geom.content_width(), safe_height),
                family,
                fonts,
                context,
                registry,
                cancel,
            )?;
            // Keep 8pt between band and document content; never overlap the body.
            let top = if is_header {
                geom.margin_top - 8.0 - measured.height
            } else {
                geom.height - geom.margin_bottom + 8.0
            };
            if top < 8.0 || top + measured.height > geom.height - 8.0 {
                return Err(RenderError::InvalidInput(
                    "page header/footer does not fit reserved margin",
                ));
            }
            measured.draw(
                &resolved,
                surface,
                font,
                registry,
                (geom.margin_left, top),
                cancel,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PdfRowColumn, TextStyle};
    fn text_row(text: &str) -> PdfRow {
        PdfRow {
            gap: 0.0,
            columns: vec![PdfRowColumn {
                width: 250.0,
                right_align: false,
                cell: None,
                items: vec![PdfRowItem::Text {
                    text: text.into(),
                    style: TextStyle::paragraph(),
                }],
            }],
        }
    }
    #[test]
    fn first_page_override_and_suppression_have_distinct_semantics() {
        let c = PdfPageChrome {
            header: Some(text_row("NORMAL")),
            first_header: Some(text_row("FIRST")),
            hide_first_footer: true,
            ..Default::default()
        };
        assert!(!c.should_draw_default_header(0));
        assert!(c.band(0, true).is_some());
        assert!(c.band(1, true).is_some());
        assert!(c.band(0, false).is_none());
        assert!(!c.should_draw_default_footer(0));
        assert!(c.should_draw_default_footer(1));
    }
    #[test]
    fn first_overrides_odd_even_and_suppression_takes_precedence() {
        let mut chrome = PdfPageChrome {
            header: Some(text_row("BASE")),
            odd_header: Some(text_row("ODD")),
            even_header: Some(text_row("EVEN")),
            first_header: Some(text_row("FIRST")),
            ..Default::default()
        };
        let label = |c: &PdfPageChrome, index| {
            let row = c.band(index, true).expect("band");
            let PdfRowItem::Text { text, .. } = &row.columns[0].items[0] else {
                panic!("text")
            };
            text.clone()
        };
        assert_eq!(label(&chrome, 0), "FIRST");
        assert_eq!(label(&chrome, 1), "EVEN");
        assert_eq!(label(&chrome, 2), "ODD");
        chrome.first_header = None;
        chrome.hide_first_header = true;
        assert!(chrome.band(0, true).is_none());
        assert!(!chrome.should_draw_default_header(0));
        chrome.hide_even_header = true;
        assert!(chrome.band(1, true).is_none());
        assert!(!chrome.should_draw_default_header(1));
        chrome.odd_header = None;
        assert_eq!(label(&chrome, 2), "BASE");
    }
    #[test]
    fn page_number_expansion_is_literal_and_nonrecursive() {
        let s = PdfPageChrome::substitute("Page {{page}}/{{total}}", 3, 19);
        assert_eq!(s, "Page 3/19");
        assert_eq!(
            PdfPageChrome::substitute("{{unknown}}", 3, 19),
            "{{unknown}}"
        );
        assert_eq!(
            PdfPageChrome::on_page(&text_row("{{page}}-{{total}}"), 2, 11)
                .columns
                .len(),
            1
        );
    }
}
