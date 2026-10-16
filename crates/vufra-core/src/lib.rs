//! Semantic model, independent of a PDF writer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageSize {
    pub width: f32,
    pub height: f32,
}
impl PageSize {
    pub const A4: Self = Self {
        width: 595.0,
        height: 842.0,
    };
}
#[derive(Clone, Debug, PartialEq)]
pub struct TableRow {
    pub label: String,
    pub height: f32,
}
impl TableRow {
    pub fn new(label: impl Into<String>, height: f32) -> Self {
        Self {
            label: label.into(),
            height,
        }
    }
}
