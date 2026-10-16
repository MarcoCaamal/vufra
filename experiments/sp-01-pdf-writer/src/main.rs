//! Low-level writer control: simple ASCII PDF, no embedded font.
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, Str};
use std::{env, error::Error, fs};

fn build() -> Vec<u8> {
    let mut pdf = Pdf::new();
    let (catalog, tree, page, font, stream) = (
        Ref::new(1),
        Ref::new(2),
        Ref::new(3),
        Ref::new(4),
        Ref::new(5),
    );
    let font_name = Name(b"F1");
    pdf.catalog(catalog).pages(tree);
    pdf.pages(tree).kids([page]).count(1);
    let mut p = pdf.page(page);
    p.parent(tree).media_box(Rect::new(0., 0., 595., 842.));
    p.contents(stream);
    p.resources().fonts().pair(font_name, font);
    p.finish();
    pdf.type1_font(font).base_font(Name(b"Helvetica"));
    let mut content = Content::new();
    content.begin_text();
    content.set_font(font_name, 28.);
    content.next_line(60., 760.);
    content.show(Str(b"Vufra - first PDF (pdf-writer)"));
    content.end_text();
    content.begin_text();
    content.set_font(font_name, 13.);
    content.next_line(60., 720.);
    content.show(Str(b"Rust + low-level PDF primitives. ASCII only."));
    content.end_text();
    pdf.stream(stream, &content.finish());
    pdf.finish()
}

fn main() -> Result<(), Box<dyn Error>> {
    let path = env::args()
        .nth(1)
        .unwrap_or_else(|| "artifacts/pdf-writer-first.pdf".into());
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, build())?;
    println!("Wrote {path}");
    Ok(())
}
