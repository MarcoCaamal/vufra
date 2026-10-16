//! Small N-API bridge. Keep all PDF logic inside vufra-pdf.
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use vufra_pdf::{PdfBlock, PdfColumn, PdfDocument, PdfTable, RenderOptions};

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
) -> napi::Result<Buffer> {
    let doc = PdfDocument {
        title,
        paragraphs,
        rows,
        table: table.map(to_table),
        blocks: blocks
            .map(|items| {
                items
                    .into_iter()
                    .map(|item| match (item.kind.as_str(), item.text, item.table) {
                        ("paragraph", Some(value), None) => Ok(PdfBlock::Paragraph(value)),
                        ("table", None, Some(value)) => Ok(PdfBlock::Table(to_table(value))),
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
