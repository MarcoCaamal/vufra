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
    pub hide_header: bool,
    pub hide_footer: bool,
    pub hide_first_header: bool,
    pub hide_first_footer: bool,
}

impl PdfPageChrome {
    fn band(&self, first: bool, header: bool) -> Option<&PdfRow> {
        if first {
            if header && self.hide_first_header || !header && self.hide_first_footer {
                return None;
            }
            let alternative = if header {
                &self.first_header
            } else {
                &self.first_footer
            };
            if alternative.is_some() {
                return alternative.as_ref();
            }
        }
        if header && self.hide_header || !header && self.hide_footer {
            return None;
        }
        if header {
            self.header.as_ref()
        } else {
            self.footer.as_ref()
        }
    }
    pub(crate) fn should_draw_default_header(&self, page: usize) -> bool {
        !(self.hide_header || page == 0 && self.hide_first_header)
            && self.band(page == 0, true).is_none()
    }
    pub(crate) fn should_draw_default_footer(&self, page: usize) -> bool {
        !(self.hide_footer || page == 0 && self.hide_first_footer)
            && self.band(page == 0, false).is_none()
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
            for row in [self.band(false, header), self.band(true, header)]
                .into_iter()
                .flatten()
            {
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
            let Some(band) = self.band(index == 0, is_header) else {
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
        assert!(c.band(true, true).is_some());
        assert!(c.band(false, true).is_some());
        assert!(c.band(true, false).is_none());
        assert!(!c.should_draw_default_footer(0));
        assert!(c.should_draw_default_footer(1));
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
