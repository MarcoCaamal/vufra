//! Small N-API bridge. Keep all PDF logic inside vufra-pdf.
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use vufra_pdf::{
    PageGeometry, PdfBlock, PdfColumn, PdfDocument, PdfTable, RenderOptions, TextStyle,
};

#[napi(object)]
pub struct NodeTableColumn {
    pub header: String,
    pub width: f64,
}

#[napi(object)]
pub struct NodeTable {
    pub columns: Vec<NodeTableColumn>,
    pub rows: Vec<Vec<String>>,
}

#[napi(object)]
pub struct NodeBlock {
    pub kind: String,
    pub text: Option<String>,
    pub table: Option<NodeTable>,
    pub level: Option<u32>,
    pub style: Option<NodeTextStyle>,
    pub height: Option<f64>,
}

#[napi(object)]
pub struct NodeTextStyle {
    pub font_size: f64,
    pub line_height: f64,
    pub space_before: f64,
    pub space_after: f64,
}

#[napi(object)]
pub struct NodePage {
    pub width: f64,
    pub height: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
}
impl From<NodePage> for PageGeometry {
    fn from(p: NodePage) -> Self {
        Self {
            width: p.width as f32,
            height: p.height as f32,
            margin_top: p.margin_top as f32,
            margin_bottom: p.margin_bottom as f32,
            margin_left: p.margin_left as f32,
            margin_right: p.margin_right as f32,
        }
    }
}
impl From<NodeTextStyle> for TextStyle {
    fn from(s: NodeTextStyle) -> Self {
        Self {
            font_size: s.font_size as f32,
            line_height: s.line_height as f32,
            space_before: s.space_before as f32,
            space_after: s.space_after as f32,
        }
    }
}

fn to_table(input: NodeTable) -> PdfTable {
    PdfTable {
        columns: input
            .columns
            .into_iter()
            .map(|column| PdfColumn {
                header: column.header,
                width: column.width as f32,
            })
            .collect(),
        rows: input.rows,
    }
}

#[napi]
pub fn render_pdf_native(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    font_data: Buffer,
    table: Option<NodeTable>,
    blocks: Option<Vec<NodeBlock>>,
    page: Option<NodePage>,
) -> napi::Result<Buffer> {
    let doc = PdfDocument {
        title,
        paragraphs,
        rows,
        table: table.map(to_table),
        page: page.map(Into::into),
        blocks: blocks
            .map(|items| {
                items
                    .into_iter()
                    .map(|item| match item.kind.as_str() {
                        "paragraph" if item.text.is_some() && item.table.is_none() => {
                            Ok(PdfBlock::Paragraph(item.text.unwrap_or_default()))
                        }
                        "heading" if item.text.is_some() && item.table.is_none() => {
                            Ok(PdfBlock::Heading {
                                text: item.text.unwrap_or_default(),
                                level: item.level.and_then(|v| u8::try_from(v).ok()).ok_or_else(
                                    || napi::Error::from_reason("Invalid heading level"),
                                )?,
                            })
                        }
                        "styled-paragraph"
                            if item.text.is_some()
                                && item.style.is_some()
                                && item.table.is_none() =>
                        {
                            Ok(PdfBlock::StyledParagraph {
                                text: item.text.unwrap_or_default(),
                                style: item.style.expect("style checked").into(),
                            })
                        }
                        "spacer"
                            if item.height.is_some()
                                && item.text.is_none()
                                && item.table.is_none() =>
                        {
                            Ok(PdfBlock::Spacer {
                                height: item.height.unwrap_or_default() as f32,
                            })
                        }
                        "table" if item.table.is_some() && item.text.is_none() => Ok(
                            PdfBlock::Table(to_table(item.table.expect("table checked"))),
                        ),
                        _ => Err(napi::Error::from_reason(
                            "Invalid flow block kind or payload",
                        )),
                    })
                    .collect::<napi::Result<Vec<_>>>()
            })
            .transpose()?,
    };
    vufra_pdf::render_pdf(&doc, font_data.as_ref(), RenderOptions::default())
        .map(Buffer::from)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}
