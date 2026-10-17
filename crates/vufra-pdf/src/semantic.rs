//! Owned, recursive semantic content AST for documents, boxes, rows and tables.
//!
//! PdfBlock/PdfBoxItem/PdfRowItem are internal painter wire structures. A
//! document normalizes to this tree before budgeting or writer preparation.
use crate::{
    BoxAlign, MAX_IMAGE_BLOCKS, MAX_TOTAL_IMAGE_BYTES, PdfBlock, PdfBox, PdfBoxItem, PdfBoxTable,
    PdfGraphic, PdfImage, PdfRow, PdfRowColumn, PdfRowItem, PdfTextRun, RenderError, TextStyle,
    row::PreparedRichFragment,
};

#[derive(Clone, Debug)]
pub enum TextPresentation {
    Paragraph,
    Heading {
        level: u8,
        keep_with_next: bool,
    },
    Styled(TextStyle),
    /// Text inside a decorated box retains its optional RGB color.
    Box {
        style: TextStyle,
        color: Option<[u8; 3]>,
    },
    Row(TextStyle),
}

#[derive(Clone, Debug)]
pub struct ContentFrame {
    pub width: Option<f32>,
    pub align: BoxAlign,
    pub padding: f32,
    pub border_width: f32,
    pub border_color: Option<[u8; 3]>,
    pub background: Option<[u8; 3]>,
    pub keep_together: bool,
    pub break_before: bool,
    pub keep_with_next: bool,
}
impl Default for ContentFrame {
    fn default() -> Self {
        Self {
            width: None,
            align: BoxAlign::Left,
            padding: 12.0,
            border_width: 0.0,
            border_color: None,
            background: None,
            keep_together: false,
            break_before: false,
            keep_with_next: false,
        }
    }
}
impl From<&PdfBox> for ContentFrame {
    fn from(b: &PdfBox) -> Self {
        Self {
            width: b.width,
            align: b.align,
            padding: b.padding,
            border_width: b.border_width,
            border_color: b.border_color,
            background: b.background,
            keep_together: b.keep_together,
            break_before: b.break_before,
            keep_with_next: b.keep_with_next,
        }
    }
}
#[derive(Clone, Debug)]
pub struct ContentColumn {
    pub width: f32,
    pub right_align: bool,
    pub children: Vec<ContentNode>,
}
impl ContentColumn {
    pub fn new(width: f32, children: Vec<ContentNode>) -> Self {
        Self {
            width,
            right_align: false,
            children,
        }
    }
}

/// One owned semantic node tree, independent of its enclosing document,
/// decorated box, row column, or table cell. The rendering backend retains
/// specialized painter representations, not an independent semantic source of truth.
#[derive(Clone, Debug)]
pub enum ContentNode {
    Text {
        text: String,
        presentation: TextPresentation,
    },
    Rich {
        runs: Vec<PdfTextRun>,
        style: TextStyle,
        keep_with_next: bool,
    },
    Image(PdfImage),
    Graphic(PdfGraphic),
    Spacer(f32),
    Row {
        gap: f32,
        columns: Vec<ContentColumn>,
    },
    Box {
        frame: ContentFrame,
        children: Vec<ContentNode>,
    },
    StyledTable {
        header: Box<ContentNode>,
        rows: Vec<ContentNode>,
        fills: Vec<Vec<Option<[u8; 3]>>>,
    },
    List {
        items: Vec<ContentNode>,
        ordered: bool,
    },
    PageBreak,
    /// Non-constructible source data: only the renderer creates real shaped lines.
    #[doc(hidden)]
    PreparedRichLine(PreparedRichFragment),
}
impl ContentNode {
    pub fn paragraph(text: impl Into<String>) -> Self {
        Self::Text {
            text: text.into(),
            presentation: TextPresentation::Paragraph,
        }
    }
    pub fn styled_text(text: impl Into<String>, style: TextStyle) -> Self {
        Self::Text {
            text: text.into(),
            presentation: TextPresentation::Styled(style),
        }
    }
    pub fn boxed(frame: ContentFrame, children: Vec<ContentNode>) -> Self {
        Self::Box { frame, children }
    }
    pub fn row(gap: f32, columns: Vec<ContentColumn>) -> Self {
        Self::Row { gap, columns }
    }
}
/// Consume bridge inputs without copying image/font payload bytes while
/// converting the NAPI wire objects into the canonical semantic AST.
impl From<PdfBlock> for ContentNode {
    fn from(block: PdfBlock) -> Self {
        match block {
            PdfBlock::Paragraph(text) => Self::paragraph(text),
            PdfBlock::Heading {
                text,
                level,
                keep_with_next,
            } => Self::Text {
                text,
                presentation: TextPresentation::Heading {
                    level,
                    keep_with_next,
                },
            },
            PdfBlock::StyledParagraph { text, style } => Self::styled_text(text, style),
            PdfBlock::RichParagraph {
                runs,
                style,
                keep_with_next,
            } => Self::Rich {
                runs,
                style,
                keep_with_next,
            },
            PdfBlock::Image(img) => Self::Image(img),
            PdfBlock::Graphic(graphic) => Self::Graphic(graphic),
            PdfBlock::Spacer { height } => Self::Spacer(height),
            PdfBlock::Row(row) => Self::from(row),
            PdfBlock::Box(boxed) => Self::from(boxed),
            PdfBlock::List { items, ordered } => Self::List {
                items: items.into_iter().map(Self::paragraph).collect(),
                ordered,
            },
            PdfBlock::PageBreak => Self::PageBreak,
        }
    }
}
impl From<PdfBox> for ContentNode {
    fn from(boxed: PdfBox) -> Self {
        let frame = ContentFrame::from(&boxed);
        Self::Box {
            frame,
            children: boxed.items.into_iter().map(Self::from).collect(),
        }
    }
}
impl From<PdfRow> for ContentNode {
    fn from(row: PdfRow) -> Self {
        Self::Row {
            gap: row.gap,
            columns: row
                .columns
                .into_iter()
                .map(|col| ContentColumn {
                    width: col.width,
                    right_align: col.right_align,
                    children: col.items.into_iter().map(Self::from).collect(),
                })
                .collect(),
        }
    }
}
impl From<PdfBoxItem> for ContentNode {
    fn from(item: PdfBoxItem) -> Self {
        match item {
            PdfBoxItem::Text { text, style, color } => Self::Text {
                text,
                presentation: TextPresentation::Box { style, color },
            },
            PdfBoxItem::RichText { runs, style } => Self::Rich {
                runs,
                style,
                keep_with_next: false,
            },
            PdfBoxItem::Image(img) => Self::Image(img),
            PdfBoxItem::Graphic(graphic) => Self::Graphic(graphic),
            PdfBoxItem::Row(row) => Self::from(row),
            PdfBoxItem::Box(boxed) => Self::from(*boxed),
            PdfBoxItem::Table(table) => Self::StyledTable {
                header: Box::new(Self::from(table.header)),
                rows: table.rows.into_iter().map(Self::from).collect(),
                fills: table.fills,
            },
            PdfBoxItem::Spacer(h) => Self::Spacer(h),
        }
    }
}
impl From<PdfRowItem> for ContentNode {
    fn from(item: PdfRowItem) -> Self {
        match item {
            PdfRowItem::Text { text, style } => Self::Text {
                text,
                presentation: TextPresentation::Row(style),
            },
            PdfRowItem::RichText { runs, style } => Self::Rich {
                runs,
                style,
                keep_with_next: false,
            },
            PdfRowItem::Image(img) => Self::Image(img),
            PdfRowItem::Graphic(graphic) => Self::Graphic(graphic),
            PdfRowItem::Box(boxed) => Self::from(*boxed),
            PdfRowItem::Spacer(h) => Self::Spacer(h),
            PdfRowItem::MeasuredRichLine(line) => Self::PreparedRichLine(line),
        }
    }
}

fn not_allowed() -> RenderError {
    RenderError::InvalidInput("semantic node unsupported in this container")
}
impl TryFrom<ContentNode> for PdfBlock {
    type Error = RenderError;
    fn try_from(node: ContentNode) -> Result<Self, Self::Error> {
        match node {
            ContentNode::Text { text, presentation } => match presentation {
                TextPresentation::Paragraph => Ok(Self::Paragraph(text)),
                TextPresentation::Heading {
                    level,
                    keep_with_next,
                } => Ok(Self::Heading {
                    text,
                    level,
                    keep_with_next,
                }),
                TextPresentation::Styled(style) | TextPresentation::Row(style) => {
                    Ok(Self::StyledParagraph { text, style })
                }
                TextPresentation::Box { style, color: None } => {
                    Ok(Self::StyledParagraph { text, style })
                }
                TextPresentation::Box { color: Some(_), .. } => Err(not_allowed()),
            },
            ContentNode::Rich {
                runs,
                style,
                keep_with_next,
            } => Ok(Self::RichParagraph {
                runs,
                style,
                keep_with_next,
            }),
            ContentNode::Image(i) => Ok(Self::Image(i)),
            ContentNode::Graphic(g) => Ok(Self::Graphic(g)),
            ContentNode::Spacer(h) => Ok(Self::Spacer { height: h }),
            ContentNode::Row { gap, columns } => Ok(Self::Row(row_from_parts(gap, columns)?)),
            ContentNode::Box { frame, children } => Ok(Self::Box(box_from_parts(frame, children)?)),
            ContentNode::List { items, ordered } => Ok(Self::List {
                items: items
                    .into_iter()
                    .map(plain_cell_text)
                    .collect::<Result<Vec<_>, _>>()?,
                ordered,
            }),
            ContentNode::PageBreak => Ok(Self::PageBreak),
            _ => Err(not_allowed()),
        }
    }
}
fn plain_cell_text(node: ContentNode) -> Result<String, RenderError> {
    match node {
        ContentNode::Text {
            text,
            presentation: TextPresentation::Paragraph,
        } => Ok(text),
        _ => Err(RenderError::InvalidInput(
            "plain list/table items require plain text nodes",
        )),
    }
}
fn row_from_parts(gap: f32, columns: Vec<ContentColumn>) -> Result<PdfRow, RenderError> {
    let columns = columns
        .into_iter()
        .map(|c| {
            Ok(PdfRowColumn {
                width: c.width,
                right_align: c.right_align,
                items: c
                    .children
                    .into_iter()
                    .map(PdfRowItem::try_from)
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect::<Result<Vec<_>, RenderError>>()?;
    Ok(PdfRow { gap, columns })
}
fn box_from_parts(frame: ContentFrame, children: Vec<ContentNode>) -> Result<PdfBox, RenderError> {
    let items = children
        .into_iter()
        .map(PdfBoxItem::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PdfBox {
        width: frame.width,
        align: frame.align,
        padding: frame.padding,
        border_width: frame.border_width,
        border_color: frame.border_color,
        background: frame.background,
        keep_together: frame.keep_together,
        break_before: frame.break_before,
        keep_with_next: frame.keep_with_next,
        items,
    })
}
impl TryFrom<ContentNode> for PdfBoxItem {
    type Error = RenderError;
    fn try_from(node: ContentNode) -> Result<Self, Self::Error> {
        match node {
            ContentNode::Text { text, presentation } => {
                let (style, color) = match presentation {
                    TextPresentation::Box { style, color } => (style, color),
                    TextPresentation::Styled(style) | TextPresentation::Row(style) => (style, None),
                    TextPresentation::Paragraph => (TextStyle::paragraph(), None),
                    TextPresentation::Heading {
                        level,
                        keep_with_next: false,
                    } => (TextStyle::heading(level)?, None),
                    TextPresentation::Heading {
                        keep_with_next: true,
                        ..
                    } => return Err(not_allowed()),
                };
                Ok(Self::Text { text, style, color })
            }
            ContentNode::Rich {
                runs,
                style,
                keep_with_next: false,
            } => Ok(Self::RichText { runs, style }),
            ContentNode::Rich {
                keep_with_next: true,
                ..
            } => Err(not_allowed()),
            ContentNode::Image(i) => Ok(Self::Image(i)),
            ContentNode::Graphic(g) => Ok(Self::Graphic(g)),
            ContentNode::Spacer(h) => Ok(Self::Spacer(h)),
            ContentNode::Row { gap, columns } => Ok(Self::Row(row_from_parts(gap, columns)?)),
            ContentNode::Box { frame, children } => {
                Ok(Self::Box(Box::new(box_from_parts(frame, children)?)))
            }
            ContentNode::StyledTable {
                header,
                rows,
                fills,
            } => {
                let header = match *header {
                    ContentNode::Row { gap, columns } => row_from_parts(gap, columns)?,
                    _ => return Err(not_allowed()),
                };
                let rows = rows
                    .into_iter()
                    .map(|r| match r {
                        ContentNode::Row { gap, columns } => row_from_parts(gap, columns),
                        _ => Err(not_allowed()),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Self::Table(PdfBoxTable {
                    header,
                    rows,
                    fills,
                }))
            }
            _ => Err(not_allowed()),
        }
    }
}
impl TryFrom<ContentNode> for PdfRowItem {
    type Error = RenderError;
    fn try_from(node: ContentNode) -> Result<Self, Self::Error> {
        match node {
            ContentNode::Text { text, presentation } => {
                let style = match presentation {
                    TextPresentation::Row(style) | TextPresentation::Styled(style) => style,
                    TextPresentation::Box { style, color: None } => style,
                    TextPresentation::Box { color: Some(_), .. } => return Err(not_allowed()),
                    TextPresentation::Paragraph => TextStyle::paragraph(),
                    TextPresentation::Heading {
                        level,
                        keep_with_next: false,
                    } => TextStyle::heading(level)?,
                    TextPresentation::Heading {
                        keep_with_next: true,
                        ..
                    } => return Err(not_allowed()),
                };
                Ok(Self::Text { text, style })
            }
            ContentNode::Rich {
                runs,
                style,
                keep_with_next: false,
            } => Ok(Self::RichText { runs, style }),
            ContentNode::Rich {
                keep_with_next: true,
                ..
            } => Err(not_allowed()),
            ContentNode::Image(i) => Ok(Self::Image(i)),
            ContentNode::Graphic(g) => Ok(Self::Graphic(g)),
            ContentNode::Spacer(h) => Ok(Self::Spacer(h)),
            ContentNode::Box { frame, children } => {
                Ok(Self::Box(Box::new(box_from_parts(frame, children)?)))
            }
            ContentNode::PreparedRichLine(f) => Ok(Self::MeasuredRichLine(f)),
            _ => Err(not_allowed()),
        }
    }
}

/// A single canonical AST used for normalized input, independent of PDF paint.
#[derive(Clone, Debug)]
pub struct SemanticDocument {
    pub title: String,
    pub nodes: Vec<ContentNode>,
    pub page: Option<crate::PageGeometry>,
    pub fonts: Vec<crate::PdfFontFace>,
    pub chrome: Option<crate::PdfPageChrome>,
}
impl SemanticDocument {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            nodes: Vec::new(),
            page: None,
            fonts: Vec::new(),
            chrome: None,
        }
    }
}

/// One recursive resource visitor for documents, boxes, rows and tables.
#[derive(Default)]
pub(crate) struct SemanticBudget {
    pub text_bytes: usize,
    pub images: usize,
    pub image_bytes: usize,
}
impl SemanticBudget {
    pub fn visit(&mut self, node: &ContentNode, depth: usize) -> Result<(), RenderError> {
        if depth > 8 {
            return Err(RenderError::InvalidInput("nested layout depth exceeds 8"));
        }
        match node {
            ContentNode::Text { text, .. } => self.add_text(text.len())?,
            ContentNode::Rich { runs, .. } => {
                if runs.len() > 1000 {
                    return Err(RenderError::InvalidInput("invalid rich text runs"));
                }
                for r in runs {
                    self.add_text(r.text.len())?;
                }
            }
            ContentNode::Image(image) => {
                self.images = self
                    .images
                    .checked_add(1)
                    .ok_or(RenderError::InvalidInput("too many images"))?;
                self.image_bytes = self
                    .image_bytes
                    .checked_add(image.data.len())
                    .ok_or(RenderError::InvalidInput("too much image data"))?;
            }
            ContentNode::Box { children, .. } => {
                if children.len() > 500 {
                    return Err(RenderError::InvalidInput("nested boxes exceed item budget"));
                }
                for child in children {
                    self.visit(child, depth + 1)?;
                }
            }
            ContentNode::Row { columns, .. } => {
                for col in columns {
                    for child in &col.children {
                        self.visit(child, depth + 1)?;
                    }
                }
            }
            ContentNode::StyledTable { header, rows, .. } => {
                self.visit(header, depth + 1)?;
                for row in rows {
                    self.visit(row, depth + 1)?;
                }
            }
            ContentNode::List { items, .. } => {
                for item in items {
                    self.visit(item, depth + 1)?;
                }
            }
            _ => {}
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
    #[test]
    fn owned_input_moves_image_buffer_without_copying() {
        let payload = vec![1, 2, 3, 4, 5];
        let address = payload.as_ptr();
        let input = PdfBlock::Image(PdfImage {
            data: payload,
            width: 20.,
            height: 20.,
            fit: crate::ImageFit::Contain,
        });
        let ContentNode::Image(img) = ContentNode::from(input) else {
            panic!("image must be owned")
        };
        assert_eq!(img.data.as_ptr(), address);
    }
    #[test]
    fn canonical_text_works_for_all_rendering_contexts() {
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
        let n1 = ContentNode::from(root);
        let n2 = ContentNode::from(boxed);
        let n3 = ContentNode::from(row);
        let mut budget = SemanticBudget::default();
        for node in [&n1, &n2, &n3] {
            budget.visit(node, 0).unwrap();
        }
        assert_eq!(budget.text_bytes, 9);
        assert!(matches!(
            PdfBlock::try_from(n1).unwrap(),
            PdfBlock::StyledParagraph { .. }
        ));
        assert!(matches!(
            PdfBoxItem::try_from(n2).unwrap(),
            PdfBoxItem::Text { .. }
        ));
        assert!(matches!(
            PdfRowItem::try_from(n3).unwrap(),
            PdfRowItem::Text { .. }
        ));
    }
    #[test]
    fn deep_box_round_trip_preserves_geometry_and_nested_rows() {
        let style = TextStyle::paragraph();
        let original = PdfBox {
            width: Some(300.),
            align: BoxAlign::Center,
            padding: 11.,
            border_width: 2.,
            border_color: Some([1, 2, 3]),
            background: Some([3, 2, 1]),
            keep_together: false,
            break_before: true,
            keep_with_next: true,
            items: vec![PdfBoxItem::Row(PdfRow {
                gap: 7.,
                columns: vec![PdfRowColumn {
                    width: 150.,
                    right_align: true,
                    items: vec![PdfRowItem::Text {
                        text: "HELLO".into(),
                        style,
                    }],
                }],
            })],
        };
        let canonical = ContentNode::from(original);
        let mut budget = SemanticBudget::default();
        budget.visit(&canonical, 0).unwrap();
        assert_eq!(budget.text_bytes, 5);
        let returned = PdfBoxItem::try_from(canonical).unwrap();
        let PdfBoxItem::Box(b) = returned else {
            panic!("must remain box")
        };
        assert_eq!(b.padding, 11.);
        assert_eq!(b.border_color, Some([1, 2, 3]));
        assert!(b.break_before && b.keep_with_next);
        let PdfBoxItem::Row(r) = &b.items[0] else {
            panic!("must remain row")
        };
        assert_eq!(r.gap, 7.);
        assert!(r.columns[0].right_align);
    }
    #[test]
    fn roundtrip_all_root_node_kinds_preserves_original_wire_semantics() {
        use crate::{GraphicKind, ImageFit};
        let style = TextStyle::paragraph();
        let img = PdfImage {
            data: include_bytes!("../../../packages/vufra/tests/fixtures/two-tone.png").to_vec(),
            width: 40.,
            height: 20.,
            fit: ImageFit::Contain,
        };
        let inputs = vec![
            PdfBlock::Paragraph("P".into()),
            PdfBlock::Heading {
                text: "H".into(),
                level: 2,
                keep_with_next: true,
            },
            PdfBlock::StyledParagraph {
                text: "S".into(),
                style,
            },
            PdfBlock::RichParagraph {
                runs: vec![PdfTextRun {
                    text: "R".into(),
                    font: "regular".into(),
                    font_size: Some(12.),
                    color: Some([1, 2, 3]),
                    fallback_fonts: vec![],
                }],
                style,
                keep_with_next: true,
            },
            PdfBlock::Image(img),
            PdfBlock::Graphic(PdfGraphic {
                kind: GraphicKind::Rectangle,
                width: 20.,
                height: 11.,
                rgb: [5, 6, 7],
            }),
            PdfBlock::Spacer { height: 17. },
            PdfBlock::PageBreak,
            PdfBlock::List {
                items: vec!["A".into(), "B".into()],
                ordered: true,
            },
            PdfBlock::Row(PdfRow {
                gap: 0.,
                columns: vec![PdfRowColumn {
                    width: 150.,
                    right_align: true,
                    items: vec![PdfRowItem::Text {
                        text: "INNER".into(),
                        style,
                    }],
                }],
            }),
            PdfBlock::Box(PdfBox {
                width: None,
                align: BoxAlign::Left,
                padding: 12.,
                border_width: 0.,
                border_color: None,
                background: Some([3, 4, 5]),
                keep_together: false,
                break_before: true,
                keep_with_next: false,
                items: vec![PdfBoxItem::RichText {
                    runs: vec![PdfTextRun {
                        text: "INNER_RICH".into(),
                        font: "regular".into(),
                        font_size: None,
                        color: Some([8, 9, 10]),
                        fallback_fonts: vec![],
                    }],
                    style,
                }],
            }),
        ];
        for input in inputs {
            let expected = format!("{input:?}");
            let canonical = ContentNode::from(input.clone());
            let actual = PdfBlock::try_from(canonical).unwrap();
            assert_eq!(format!("{actual:?}"), expected);
        }
    }
    #[test]
    fn canonical_semantics_reject_lossy_nested_styling_and_invalid_list_cells() {
        let style = TextStyle::paragraph();
        let rich = ContentNode::Rich {
            runs: vec![PdfTextRun {
                text: "X".into(),
                font: "regular".into(),
                font_size: None,
                color: None,
                fallback_fonts: vec![],
            }],
            style,
            keep_with_next: true,
        };
        assert!(PdfBoxItem::try_from(rich.clone()).is_err());
        assert!(PdfRowItem::try_from(rich).is_err());
        assert!(
            PdfBoxItem::try_from(ContentNode::Text {
                text: "heading".into(),
                presentation: TextPresentation::Heading {
                    level: 1,
                    keep_with_next: true
                }
            })
            .is_err()
        );
        assert!(
            PdfBlock::try_from(ContentNode::List {
                items: vec![ContentNode::styled_text("colored", style)],
                ordered: false,
            })
            .is_err()
        );
    }
    #[test]
    fn invalid_container_nesting_returns_clear_error() {
        assert!(PdfRowItem::try_from(ContentNode::PageBreak).is_err());
        assert!(PdfBoxItem::try_from(ContentNode::PageBreak).is_err());
        assert!(
            PdfBlock::try_from(ContentNode::StyledTable {
                header: Box::new(ContentNode::paragraph("not a header")),
                rows: vec![],
                fills: vec![]
            })
            .is_err()
        );
    }
}
