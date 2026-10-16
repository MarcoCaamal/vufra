//! Small N-API bridge. Keep all PDF logic inside vufra-pdf.
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use vufra_pdf::{PdfDocument, RenderOptions};

#[napi]
pub fn render_pdf_native(
    title: String,
    paragraphs: Vec<String>,
    rows: Vec<String>,
    font_data: Buffer,
) -> napi::Result<Buffer> {
    let doc = PdfDocument {
        title,
        paragraphs,
        rows,
    };
    vufra_pdf::render_pdf(&doc, font_data.as_ref(), RenderOptions::default())
        .map(Buffer::from)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}
