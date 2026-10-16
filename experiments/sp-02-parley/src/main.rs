//! Text measurement and line breaking, without PDF output.
use parley::{Alignment, AlignmentOptions, FontContext, Layout, LayoutContext, StyleProperty};
fn main() {
    let mut fonts = FontContext::new();
    let mut context = LayoutContext::new();
    let text = "Cancún, niño, acción, ¿Qué? Texto largo que debe partirse en varias líneas cuando se limita el ancho del párrafo.";
    for width in [180.0, 360.0] {
        let mut builder = context.ranged_builder(&mut fonts, text, 1.0, true);
        builder.push_default(StyleProperty::FontSize(16.0));
        let mut layout: Layout<()> = builder.build(text);
        layout.break_all_lines(Some(width));
        layout.align(Alignment::Start, AlignmentOptions::default());
        println!(
            "width={width}, measured_width={}, height={}, lines={}",
            layout.width(),
            layout.height(),
            layout.lines().count()
        );
    }
}
