//! Canonical *semantic view* for the three historical PDF inputs.
//! Existing NAPI/wire structs remain stable. Rendering/pagination can inspect
//! uniform semantics without duplicating knowledge of PdfBlock/PdfBoxItem/PdfRowItem.
use crate::{
    MAX_IMAGE_BLOCKS, MAX_TOTAL_IMAGE_BYTES, PdfBlock, PdfBox, PdfBoxItem, PdfBoxTable, PdfImage,
    PdfRow, PdfRowItem, PdfTextRun, RenderError,
};

pub(crate) enum SemanticNode<'a> {
    Text(&'a str),
    Rich(&'a [PdfTextRun]),
    Image(&'a PdfImage),
    Box(&'a PdfBox),
    Row(&'a PdfRow),
    Table(&'a PdfBoxTable),
    Other,
}
pub(crate) trait SemanticView {
    fn semantic(&self) -> SemanticNode<'_>;
}
impl SemanticView for PdfBlock {
    fn semantic(&self) -> SemanticNode<'_> {
        match self {
            Self::Paragraph(s)
            | Self::StyledParagraph { text: s, .. }
            | Self::Heading { text: s, .. } => SemanticNode::Text(s),
            Self::RichParagraph { runs, .. } => SemanticNode::Rich(runs),
            Self::Image(img) => SemanticNode::Image(img),
            Self::Row(row) => SemanticNode::Row(row),
            Self::Box(boxed) => SemanticNode::Box(boxed),
            _ => SemanticNode::Other,
        }
    }
}
impl SemanticView for PdfBoxItem {
    fn semantic(&self) -> SemanticNode<'_> {
        match self {
            Self::Text { text, .. } => SemanticNode::Text(text),
            Self::RichText { runs, .. } => SemanticNode::Rich(runs),
            Self::Image(image) => SemanticNode::Image(image),
            Self::Box(boxed) => SemanticNode::Box(boxed),
            Self::Row(row) => SemanticNode::Row(row),
            Self::Table(table) => SemanticNode::Table(table),
            _ => SemanticNode::Other,
        }
    }
}
impl SemanticView for PdfRowItem {
    fn semantic(&self) -> SemanticNode<'_> {
        match self {
            Self::Text { text, .. } => SemanticNode::Text(text),
            Self::RichText { runs, .. } => SemanticNode::Rich(runs),
            Self::Image(image) => SemanticNode::Image(image),
            Self::Box(boxed) => SemanticNode::Box(boxed),
            // Cached shaped fragments exist *only* after budgeting the original
            // AST and must never get counted a second time.
            Self::MeasuredRichLine(..) => SemanticNode::Other,
            _ => SemanticNode::Other,
        }
    }
}
#[derive(Default)]
pub(crate) struct SemanticBudget {
    pub text_bytes: usize,
    pub images: usize,
    pub image_bytes: usize,
}
impl SemanticBudget {
    /// Recursively account for semantic content across boxes, rows and tables.
    /// This is the same canonical visitor regardless of parent container.
    pub fn visit<T: SemanticView>(&mut self, item: &T, depth: usize) -> Result<(), RenderError> {
        if depth > 8 {
            return Err(RenderError::InvalidInput("nested layout depth exceeds 8"));
        }
        match item.semantic() {
            SemanticNode::Text(s) => self.add_text(s.len())?,
            SemanticNode::Rich(runs) => {
                for run in runs {
                    self.add_text(run.text.len())?;
                }
            }
            SemanticNode::Image(image) => {
                self.images = self
                    .images
                    .checked_add(1)
                    .ok_or(RenderError::InvalidInput("too many images"))?;
                self.image_bytes = self
                    .image_bytes
                    .checked_add(image.data.len())
                    .ok_or(RenderError::InvalidInput("too much image data"))?;
            }
            SemanticNode::Box(boxed) => {
                if boxed.items.len() > 500 {
                    return Err(RenderError::InvalidInput("nested boxes exceed item budget"));
                }
                for child in &boxed.items {
                    self.visit(child, depth + 1)?;
                }
            }
            SemanticNode::Row(row) => {
                for column in &row.columns {
                    for child in &column.items {
                        self.visit(child, depth + 1)?;
                    }
                }
            }
            SemanticNode::Table(table) => {
                for row in std::iter::once(&table.header).chain(&table.rows) {
                    for column in &row.columns {
                        for child in &column.items {
                            self.visit(child, depth + 1)?;
                        }
                    }
                }
            }
            SemanticNode::Other => {}
        }
        if self.images > MAX_IMAGE_BLOCKS || self.image_bytes > MAX_TOTAL_IMAGE_BYTES {
            return Err(RenderError::InvalidInput(
                "nested box exceeds resource budget",
            ));
        }
        Ok(())
    }
    fn add_text(&mut self, bytes: usize) -> Result<(), RenderError> {
        self.text_bytes = self
            .text_bytes
            .checked_add(bytes)
            .ok_or(RenderError::InvalidInput("text too large"))?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PdfRowColumn, TextStyle};
    #[test]
    fn text_view_same_for_root_box_and_row() {
        let style = TextStyle::paragraph();
        let root = PdfBlock::StyledParagraph {
            text: "abc".into(),
            style,
        };
        let boxed = PdfBoxItem::Text {
            text: "abc".into(),
            style,
            color: None,
        };
        let row = PdfRowItem::Text {
            text: "abc".into(),
            style,
        };
        let mut budget = SemanticBudget::default();
        budget.visit(&root, 0).unwrap();
        budget.visit(&boxed, 0).unwrap();
        budget.visit(&row, 0).unwrap();
        assert_eq!(budget.text_bytes, 9);
    }
    #[test]
    fn recursive_budget_counts_rows_inside_boxes_without_duplicate_logic() {
        let style = TextStyle::paragraph();
        let row = PdfRow {
            gap: 0.,
            columns: vec![PdfRowColumn {
                width: 150.,
                right_align: false,
                items: vec![PdfRowItem::Text {
                    text: "ALPHA".into(),
                    style,
                }],
            }],
        };
        let boxed = PdfBox {
            width: None,
            align: crate::BoxAlign::Left,
            padding: 0.,
            border_width: 0.,
            border_color: None,
            background: None,
            keep_together: false,
            break_before: false,
            keep_with_next: false,
            items: vec![PdfBoxItem::Row(row)],
        };
        let mut budget = SemanticBudget::default();
        budget.visit(&PdfBlock::Box(boxed), 0).unwrap();
        assert_eq!(budget.text_bytes, 5);
    }
}
