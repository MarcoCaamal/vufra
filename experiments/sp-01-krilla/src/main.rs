//! High-level writer: two pages, embedded font, Unicode.
use krilla::{
    Document,
    geom::Point,
    page::PageSettings,
    text::{Font, TextDirection},
};
use std::{env, error::Error, fs};

fn main() -> Result<(), Box<dyn Error>> {
    let output = env::args()
        .nth(1)
        .unwrap_or_else(|| "artifacts/krilla-first.pdf".into());
    let font_path = env::args()
        .nth(2)
        .or_else(|| env::var("VUFRA_FONT").ok())
        .ok_or("Pass a font path as second argument")?;
    let font = Font::new(fs::read(font_path)?.into(), 0).ok_or("Unsupported font")?;
    let mut document = Document::new();
    for (index, title) in [
        "Vufra: ¡Hola, Cancún! Niño, acción y México.",
        "Página 2: texto Unicode seleccionable — ¿Qué tal?",
    ]
    .iter()
    .enumerate()
    {
        let mut page = document
            .start_page_with(PageSettings::from_wh(595.0, 842.0).ok_or("Invalid page size")?);
        let mut surface = page.surface();
        surface.draw_text(
            Point::from_xy(60.0, 80.0),
            font.clone(),
            23.0,
            title,
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(60.0, 130.0),
            font.clone(),
            13.0,
            &format!(
                "Página {}/2. Prueba de fuentes incrustadas y extracción.",
                index + 1
            ),
            false,
            TextDirection::Auto,
        );
        surface.finish();
        page.finish();
    }
    let pdf = document.finish()?;
    if let Some(parent) = std::path::Path::new(&output).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output, pdf)?;
    println!("Wrote {output}");
    Ok(())
}
