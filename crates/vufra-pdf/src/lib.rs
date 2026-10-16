//! Experimental high-level Vufra PDF renderer. API may change until v1.
//! Input is semantic text and rows; the supplied font is embedded in the output.
//! Current shaping/rendering path is validated for Latin text, not bidi or fallback.

use krilla::{
    Document as KrillaDocument,
    geom::Point,
    page::PageSettings,
    text::{Font, TextDirection},
};
use parley::{
    Alignment, AlignmentOptions, FontContext, FontFamily, FontFamilyName, Layout, LayoutContext,
    StyleProperty,
    fontique::{Blob, Collection, CollectionOptions, SourceCache},
};
use std::{borrow::Cow, error::Error, fmt, sync::Arc};
use vufra_core::TableRow;
use vufra_layout::{PaginationError, paginate_all};

const PAGE_WIDTH: f32 = 595.0;
const PAGE_HEIGHT: f32 = 842.0;
const LEFT: f32 = 49.0;
const CONTENT_WIDTH: f32 = PAGE_WIDTH - 2.0 * LEFT;
const TEXT_TOP: f32 = 120.0;
const CONTENT_HEIGHT: f32 = 650.0;
const MAX_FONT_BYTES: usize = 20 * 1024 * 1024;
const MAX_ROWS: usize = 10_000;
const MAX_PARAGRAPHS: usize = 1000;
const MAX_TOTAL_TEXT_BYTES: usize = 4 * 1024 * 1024;

/// An ordered list of paragraphs followed by independent table rows.
/// Rows may wrap inside their own row; rows taller than one page are rejected.
#[derive(Debug, Clone, Default)]
pub struct PdfDocument {
    pub title: String,
    pub paragraphs: Vec<String>,
    pub rows: Vec<String>,
}

/// Render settings. Defaults are chosen for an A4 document.
#[derive(Debug, Clone, Copy)]
pub struct RenderOptions {
    pub text_size: f32,
    pub line_height: f32,
}
impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            text_size: 11.0,
            line_height: 16.0,
        }
    }
}

/// Error without process crashes on invalid user input.
#[derive(Debug)]
pub enum RenderError {
    InvalidInput(&'static str),
    InvalidFont,
    InvalidLayout(PaginationError),
    InvalidPdf(String),
}
impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(f, "Invalid document: {message}"),
            Self::InvalidFont => write!(f, "Font is missing, oversized, or unsupported"),
            Self::InvalidLayout(error) => write!(f, "Document pagination failed: {error}"),
            Self::InvalidPdf(error) => write!(f, "PDF generation failed: {error}"),
        }
    }
}
impl Error for RenderError {}

struct PreparedEntry {
    lines: Vec<String>,
    height: f32,
    is_row: bool,
}

fn validate(
    document: &PdfDocument,
    font_bytes: &[u8],
    options: RenderOptions,
) -> Result<(), RenderError> {
    if document.title.trim().is_empty() {
        return Err(RenderError::InvalidInput("title must be nonempty"));
    }
    if document.paragraphs.len() > MAX_PARAGRAPHS || document.rows.len() > MAX_ROWS {
        return Err(RenderError::InvalidInput("too many paragraphs or rows"));
    }
    if font_bytes.len() > MAX_FONT_BYTES || font_bytes.is_empty() {
        return Err(RenderError::InvalidFont);
    }
    if !options.text_size.is_finite()
        || !options.line_height.is_finite()
        || !(6.0..=24.0).contains(&options.text_size)
        || !(10.0..=48.0).contains(&options.line_height)
        || options.line_height < options.text_size
    {
        return Err(RenderError::InvalidInput(
            "text size or line height outside accepted range",
        ));
    }
    let total = document.paragraphs.iter().chain(&document.rows).try_fold(
        document.title.len(),
        |sum, item| {
            sum.checked_add(item.len())
                .ok_or(RenderError::InvalidInput("text too large"))
        },
    )?;
    if total > MAX_TOTAL_TEXT_BYTES {
        return Err(RenderError::InvalidInput("text too large"));
    }
    if document.title.chars().any(|ch| ch == '\0') {
        return Err(RenderError::InvalidInput("title contains null byte"));
    }
    Ok(())
}

/// Generate full PDF bytes in memory; there is no filesystem access in this API.
/// Supply the actual TTF/OTF bytes to guarantee that the font can be embedded.
pub fn render_pdf(
    document: &PdfDocument,
    font_bytes: &[u8],
    options: RenderOptions,
) -> Result<Vec<u8>, RenderError> {
    validate(document, font_bytes, options)?;
    let font = Font::new(font_bytes.to_vec().into(), 0).ok_or(RenderError::InvalidFont)?;
    // No host/system font substitution in measurements. Only the embedded input
    // font participates in layout; unsupported scripts are a documented limitation.
    let mut font_context = FontContext {
        collection: Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        }),
        source_cache: SourceCache::default(),
    };
    let registered = font_context
        .collection
        .register_fonts(Blob::new(Arc::new(font_bytes.to_vec())), None);
    let family_id = registered.first().ok_or(RenderError::InvalidFont)?.0;
    let family = font_context
        .collection
        .family_name(family_id)
        .ok_or(RenderError::InvalidFont)?
        .to_string();
    let mut layout_context: LayoutContext<()> = LayoutContext::new();
    // The current header is a single line. Do not draw off the A4 page.
    let mut title_builder =
        layout_context.ranged_builder(&mut font_context, &document.title, 1.0, false);
    title_builder.push_default(StyleProperty::FontSize(18.0));
    title_builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
        FontFamilyName::Named(Cow::Owned(family.clone())),
    )));
    let mut title_layout: Layout<()> = title_builder.build(&document.title);
    title_layout.break_all_lines(None);
    if title_layout.width() > CONTENT_WIDTH {
        return Err(RenderError::InvalidInput("title exceeds printable width"));
    }
    let mut prepared = Vec::with_capacity(document.paragraphs.len() + document.rows.len());
    for paragraph in &document.paragraphs {
        prepared.push(prepare(
            paragraph,
            false,
            &family,
            &mut font_context,
            &mut layout_context,
            options,
        )?);
    }
    for (index, row) in document.rows.iter().enumerate() {
        let text = format!("{:04}  |  {row}", index + 1);
        prepared.push(prepare(
            &text,
            true,
            &family,
            &mut font_context,
            &mut layout_context,
            options,
        )?);
    }
    let layout_rows = prepared
        .iter()
        .map(|item| TableRow::new("rendered text block", item.height))
        .collect::<Vec<_>>();
    let pages =
        paginate_all(&layout_rows, CONTENT_HEIGHT, 0.0).map_err(RenderError::InvalidLayout)?;
    let page_count = pages.len();

    let mut output = KrillaDocument::new();
    for (page_index, page_data) in pages.iter().enumerate() {
        let settings = PageSettings::from_wh(PAGE_WIDTH, PAGE_HEIGHT)
            .ok_or(RenderError::InvalidInput("invalid paper size"))?;
        let mut page = output.start_page_with(settings);
        let mut surface = page.surface();
        // Headers and footers are reserved outside body: [120, 770].
        surface.draw_text(
            Point::from_xy(LEFT, 51.0),
            font.clone(),
            18.0,
            &document.title,
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(LEFT, 87.0),
            font.clone(),
            10.0,
            "Vufra • Documento generado desde Rust",
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(LEFT, 812.0),
            font.clone(),
            10.0,
            &format!("Página {} / {}", page_index + 1, page_count),
            false,
            TextDirection::Auto,
        );
        let mut y = TEXT_TOP;
        for entry in &prepared[page_data.start_row..page_data.end_row] {
            for line in &entry.lines {
                if !line.is_empty() {
                    surface.draw_text(
                        Point::from_xy(LEFT, y),
                        font.clone(),
                        options.text_size,
                        line,
                        false,
                        TextDirection::Auto,
                    );
                }
                y += options.line_height;
            }
            y += if entry.is_row { 4.0 } else { 9.0 };
        }
        surface.finish();
        page.finish();
    }
    output
        .finish()
        .map_err(|error| RenderError::InvalidPdf(format!("{error:?}")))
}

fn prepare(
    input: &str,
    is_row: bool,
    family: &str,
    fonts: &mut FontContext,
    context: &mut LayoutContext<()>,
    options: RenderOptions,
) -> Result<PreparedEntry, RenderError> {
    if input.contains('\0') {
        return Err(RenderError::InvalidInput("text contains null byte"));
    }
    let lines = if input.trim().is_empty() {
        vec![String::new()]
    } else {
        let mut builder = context.ranged_builder(fonts, input, 1.0, false);
        builder.push_default(StyleProperty::FontSize(options.text_size));
        builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
            FontFamilyName::Named(Cow::Owned(family.to_string())),
        )));
        let mut layout: Layout<()> = builder.build(input);
        layout.break_all_lines(Some(CONTENT_WIDTH));
        layout.align(Alignment::Start, AlignmentOptions::default());
        // Parley may hang trailing whitespace beyond the line box; don't count
        // that against visible text width.
        if layout.lines().any(|line| {
            line.metrics().advance - line.metrics().hanging_advance > CONTENT_WIDTH + 0.5
        }) {
            return Err(RenderError::InvalidInput(
                "unbreakable text exceeds printable width",
            ));
        }
        layout
            .lines()
            .map(|line| {
                input[line.text_range()]
                    .trim_end_matches(['\r', '\n'])
                    .to_string()
            })
            .collect::<Vec<_>>()
    };
    let height = lines.len() as f32 * options.line_height + if is_row { 4.0 } else { 9.0 };
    if height > CONTENT_HEIGHT {
        return Err(RenderError::InvalidInput(
            "paragraph or row exceeds one printable page",
        ));
    }
    Ok(PreparedEntry {
        lines,
        height,
        is_row,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_inputs_without_panicking() {
        let f = &[1, 2, 3];
        let doc = PdfDocument::default();
        assert!(matches!(
            render_pdf(&doc, f, RenderOptions::default()),
            Err(RenderError::InvalidInput(_))
        ));
        let doc = PdfDocument {
            title: "Test".into(),
            ..Default::default()
        };
        assert!(matches!(
            render_pdf(&doc, f, RenderOptions::default()),
            Err(RenderError::InvalidFont)
        ));
        assert!(matches!(
            render_pdf(
                &doc,
                f,
                RenderOptions {
                    text_size: f32::NAN,
                    ..Default::default()
                }
            ),
            Err(RenderError::InvalidInput(_))
        ));
    }
    #[test]
    fn rejects_excessive_row_counts() {
        let doc = PdfDocument {
            title: "Test".into(),
            rows: vec!["x".into(); 10001],
            paragraphs: vec![],
        };
        assert!(matches!(
            render_pdf(&doc, &[1], RenderOptions::default()),
            Err(RenderError::InvalidInput(_))
        ));
    }
}
