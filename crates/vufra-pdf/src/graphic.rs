//! Simple vector rectangles and horizontal rules as paginated blocks.
use crate::RenderError;
use krilla::{
    color::rgb,
    geom::{PathBuilder, Rect},
    paint::Fill,
    surface::Surface,
};
#[derive(Debug, Clone, Copy)]
pub enum GraphicKind {
    Rule,
    Rectangle,
}
#[derive(Debug, Clone, Copy)]
pub struct PdfGraphic {
    pub kind: GraphicKind,
    pub width: f32,
    pub height: f32,
    pub rgb: [u8; 3],
}
impl PdfGraphic {
    pub fn validate(&self, content_width: f32, content_height: f32) -> Result<(), RenderError> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || self.width <= 0.0
            || self.height <= 0.0
            || self.width > content_width
            || self.height > content_height
            || matches!(self.kind, GraphicKind::Rule) && self.height > 8.0
        {
            return Err(RenderError::InvalidInput(
                "invalid graphic width, height, or printable area",
            ));
        }
        Ok(())
    }
    pub fn draw(&self, surface: &mut Surface, x: f32, y: f32) -> Result<(), RenderError> {
        let rect = Rect::from_xywh(x, y, self.width, self.height)
            .ok_or(RenderError::InvalidInput("invalid graphic rectangle"))?;
        let mut builder = PathBuilder::new();
        builder.push_rect(rect);
        let path = builder
            .finish()
            .ok_or(RenderError::InvalidInput("invalid graphic path"))?;
        let old_fill = surface.get_fill().cloned();
        let old_stroke = surface.get_stroke().cloned();
        surface.set_stroke(None);
        surface.set_fill(Some(Fill {
            paint: rgb::Color::new(self.rgb[0], self.rgb[1], self.rgb[2]).into(),
            ..Fill::default()
        }));
        surface.draw_path(&path);
        surface.set_fill(old_fill);
        surface.set_stroke(old_stroke);
        Ok(())
    }
}
