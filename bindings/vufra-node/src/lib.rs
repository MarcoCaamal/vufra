//! Small N-API bridge. Keep all PDF logic inside vufra-pdf.
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use vufra_pdf::{PdfColumn, PdfDocument, PdfTable, RenderOptions};

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

#[napi]
pub fn render_pdf_native(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    font_data: Buffer,
    table: Option<NodeTable>,
) -> napi::Result<Buffer> {
    let doc = PdfDocument {
        title,
        paragraphs,
        rows,
        table: table.map(|input| PdfTable {
            columns: input
                .columns
                .into_iter()
                .map(|column| PdfColumn {
                    header: column.header,
                    width: column.width as f32,
                })
                .collect(),
            rows: input.rows,
        }),
    };
    vufra_pdf::render_pdf(&doc, font_data.as_ref(), RenderOptions::default())
        .map(Buffer::from)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}
