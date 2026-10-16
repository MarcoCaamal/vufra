//! Integration: 1000 rows -> BreakToken -> independently valid multipage PDF.
use krilla::{
    Document,
    geom::Point,
    page::PageSettings,
    text::{Font, TextDirection},
};
use std::{env, error::Error, fs};
use vufra_core::TableRow;
use vufra_layout::paginate_all;

fn main() -> Result<(), Box<dyn Error>> {
    let output = env::args()
        .nth(1)
        .unwrap_or_else(|| "artifacts/1000-rows.pdf".into());
    let font_path = env::args()
        .nth(2)
        .or_else(|| env::var("VUFRA_FONT").ok())
        .ok_or("Pass a font path as second argument")?;
    let font = Font::new(fs::read(font_path)?.into(), 0).ok_or("Unsupported font")?;
    let rows = (0..1000)
        .map(|i| {
            TableRow::new(
                format!("Fila {:04} - certificado PDF de Vufra", i + 1),
                19.0,
            )
        })
        .collect::<Vec<_>>();
    let fragments = paginate_all(&rows, 700.0, 28.0)?;
    let mut doc = Document::new();
    for (page_index, fragment) in fragments.iter().enumerate() {
        let mut page =
            doc.start_page_with(PageSettings::from_wh(595.0, 842.0).ok_or("Invalid page size")?);
        let mut surface = page.surface();
        surface.draw_text(
            Point::from_xy(46.0, 52.0),
            font.clone(),
            15.0,
            "Vufra — prueba de paginación (1,000 filas)",
            false,
            TextDirection::Auto,
        );
        surface.draw_text(
            Point::from_xy(46.0, 90.0),
            font.clone(),
            11.0,
            "ID     |     Descripción",
            false,
            TextDirection::Auto,
        );
        for (local_index, row_index) in (fragment.start_row..fragment.end_row).enumerate() {
            surface.draw_text(
                Point::from_xy(50.0, 116.0 + local_index as f32 * 19.0),
                font.clone(),
                10.0,
                &rows[row_index].label,
                false,
                TextDirection::Auto,
            );
        }
        surface.draw_text(
            Point::from_xy(46.0, 810.0),
            font.clone(),
            10.0,
            &format!(
                "Página {} / {} | filas {}-{}",
                page_index + 1,
                fragments.len(),
                fragment.start_row + 1,
                fragment.end_row
            ),
            false,
            TextDirection::Auto,
        );
        surface.finish();
        page.finish();
    }
    let output_pdf = doc.finish()?;
    if let Some(parent) = std::path::Path::new(&output).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output, output_pdf)?;
    println!("Wrote {} pages to {output}; rows=1000", fragments.len());
    Ok(())
}
