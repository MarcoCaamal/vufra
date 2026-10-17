//! Writer-independent recursive layout measurement and break metadata.
//! The PDF renderer lowers semantic content into this geometry tree; pagination
//! never needs to know whether a leaf is text, an image, a row or another atom.
use crate::{
    PaginationError,
    flow::{BoxNestedSpan, BoxRepeatSpan},
};

#[derive(Debug, Clone, PartialEq)]
pub enum LayoutNode {
    Leaf(f32),
    Container {
        padding: f32,
        keep_together: bool,
        break_before: bool,
        children: Vec<LayoutNode>,
    },
    RepeatTable {
        header: f32,
        rows: Vec<f32>,
    },
}
#[derive(Debug, Clone, PartialEq)]
pub struct FlattenedLayout {
    pub heights: Vec<f32>,
    pub groups: Vec<BoxNestedSpan>,
    pub headers: Vec<BoxRepeatSpan>,
}
impl FlattenedLayout {
    pub fn from_nodes(nodes: &[LayoutNode]) -> Result<Self, PaginationError> {
        let mut out = Self {
            heights: Vec::new(),
            groups: Vec::new(),
            headers: Vec::new(),
        };
        for node in nodes {
            out.visit(node, 0)?;
        }
        if out.heights.is_empty() || out.heights.len() > 10_000 {
            return Err(PaginationError::InvalidHeight);
        }
        Ok(out)
    }
    fn visit(&mut self, node: &LayoutNode, depth: usize) -> Result<(), PaginationError> {
        if depth > 8 {
            return Err(PaginationError::InvalidHeight);
        }
        match node {
            LayoutNode::Leaf(height) => {
                if !height.is_finite() || *height <= 0.0 {
                    return Err(PaginationError::InvalidHeight);
                }
                self.heights.push(*height);
            }
            LayoutNode::Container {
                padding,
                keep_together,
                break_before,
                children,
            } => {
                if !padding.is_finite() || !(0.0..=60.0).contains(padding) || children.is_empty() {
                    return Err(PaginationError::InvalidHeight);
                }
                let start = self.heights.len();
                // Parent first in DFS: the paginator validates proper nesting.
                self.groups.push(BoxNestedSpan {
                    start_item: start,
                    end_item: start,
                    padding: *padding,
                    keep_together: *keep_together,
                    break_before: *break_before,
                });
                let group_index = self.groups.len() - 1;
                for child in children {
                    self.visit(child, depth + 1)?;
                }
                let end = self.heights.len();
                self.groups[group_index].end_item = end;
            }
            LayoutNode::RepeatTable { header, rows } => {
                if !header.is_finite() || *header <= 0.0 || rows.is_empty() {
                    return Err(PaginationError::InvalidHeight);
                }
                let start = self.heights.len();
                self.visit(&LayoutNode::Leaf(*header), depth)?;
                for height in rows {
                    self.visit(&LayoutNode::Leaf(*height), depth)?;
                }
                self.headers.push(BoxRepeatSpan {
                    header_item: start,
                    end_item: self.heights.len(),
                });
            }
        }
        if self.heights.len() > 10_000 {
            return Err(PaginationError::InvalidHeight);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_tree_preserves_exact_leaf_order_nested_spans_and_header_locations() {
        let nodes = vec![
            LayoutNode::Leaf(11.0),
            LayoutNode::Container {
                padding: 8.0,
                keep_together: false,
                break_before: false,
                children: vec![
                    LayoutNode::Leaf(12.0),
                    LayoutNode::Container {
                        padding: 5.0,
                        keep_together: false,
                        break_before: false,
                        children: vec![LayoutNode::RepeatTable {
                            header: 15.0,
                            rows: vec![17.0, 17.0, 19.0],
                        }],
                    },
                    LayoutNode::Leaf(13.0),
                ],
            },
            LayoutNode::Leaf(14.0),
        ];
        let flat = FlattenedLayout::from_nodes(&nodes).unwrap();
        assert_eq!(
            flat.heights,
            vec![11.0, 12.0, 15.0, 17.0, 17.0, 19.0, 13.0, 14.0]
        );
        assert_eq!(flat.groups[0].start_item, 1);
        assert_eq!(flat.groups[0].end_item, 7);
        assert_eq!(flat.groups[1].start_item, 2);
        assert_eq!(flat.groups[1].end_item, 6);
        assert_eq!(
            flat.headers,
            vec![BoxRepeatSpan {
                header_item: 2,
                end_item: 6
            }]
        );
    }
    #[test]
    fn rejects_invalid_leaf_padding_empty_tables_and_excessive_depth() {
        assert!(FlattenedLayout::from_nodes(&[LayoutNode::Leaf(f32::NAN)]).is_err());
        assert!(
            FlattenedLayout::from_nodes(&[LayoutNode::RepeatTable {
                header: 15.0,
                rows: vec![]
            }])
            .is_err()
        );
        let mut node = LayoutNode::Leaf(14.0);
        for _ in 0..10 {
            node = LayoutNode::Container {
                padding: 0.0,
                keep_together: false,
                break_before: false,
                children: vec![node],
            };
        }
        assert!(FlattenedLayout::from_nodes(&[node]).is_err());
    }
}
