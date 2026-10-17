//! Owned semantic tree example for Rust callers, no TS/NAPI required.
//! cargo run -p vufra-pdf --example owned-semantic -- <regular.ttf> <bold.ttf> <output.pdf>
use std::{error::Error, fs, path::PathBuf};
use vufra_pdf::{
    BoxAlign, ContentColumn, ContentFrame, ContentNode, ImageFit, PageGeometry, PdfFontFace,
    PdfImage, PdfTextRun, RenderOptions, SemanticDocument, TextPresentation, TextStyle,
    render_semantic_pdf,
};
fn tokens(prefix: &str, n: usize) -> String {
    (1..=n)
        .map(|i| format!("{prefix}{i:04}"))
        .collect::<Vec<_>>()
        .join(" ")
}
fn main() -> Result<(), Box<dyn Error>> {
    let argv = std::env::args().collect::<Vec<_>>();
    if argv.len() != 4 {
        return Err("usage: owned-semantic REGULAR.ttf BOLD.ttf OUTPUT.pdf".into());
    }
    let font = fs::read(&argv[1])?;
    let bold = fs::read(&argv[2])?;
    let output = PathBuf::from(&argv[3]);
    let mut doc = SemanticDocument::new("Vufra | Rust Semantic AST");
    doc.page = Some(PageGeometry::letter());
    doc.fonts = vec![PdfFontFace {
        name: "bold".into(),
        data: bold,
    }];
    let style = TextStyle::paragraph();
    doc.nodes
        .push(ContentNode::paragraph("CANONICAL_ROOT_MARKER"));
    doc.nodes.push(ContentNode::boxed(
        ContentFrame {
            padding: 14.,
            align: BoxAlign::Left,
            background: Some([245, 249, 255]),
            border_color: Some([45, 85, 145]),
            border_width: 1.,
            ..ContentFrame::default()
        },
        vec![
            ContentNode::Image(PdfImage {
                data: include_bytes!("../../../packages/vufra/tests/fixtures/two-tone.png")
                    .to_vec(),
                width: 55.,
                height: 28.,
                fit: ImageFit::Contain,
            }),
            ContentNode::Text {
                text: "CANONICAL_INSIDE_BOX".into(),
                presentation: TextPresentation::Box {
                    style,
                    color: Some([20, 40, 100]),
                },
            },
            ContentNode::StyledTable {
                header: Box::new(ContentNode::row(
                    0.,
                    vec![
                        ContentColumn::new(150., vec![ContentNode::paragraph("REPEATED_REF")]),
                        ContentColumn::new(336., vec![ContentNode::paragraph("REPEATED_DATA")]),
                    ],
                )),
                rows: vec![ContentNode::row(
                    0.,
                    vec![
                        ContentColumn::new(150., vec![ContentNode::paragraph("FIRST_ROW")]),
                        ContentColumn::new(
                            336.,
                            vec![ContentNode::Rich {
                                runs: vec![
                                    PdfTextRun {
                                        text: tokens("CANONBOLD_", 130) + " ",
                                        font: "bold".into(),
                                        font_size: Some(11.),
                                        color: Some([175, 35, 65]),
                                        fallback_fonts: vec![],
                                    },
                                    PdfTextRun {
                                        text: tokens("CANONREG_", 130),
                                        font: "regular".into(),
                                        font_size: Some(11.),
                                        color: None,
                                        fallback_fonts: vec![],
                                    },
                                ],
                                style,
                                keep_with_next: false,
                            }],
                        ),
                    ],
                )],
                fills: vec![
                    vec![Some([225, 236, 249]), Some([225, 236, 249])],
                    vec![None, Some([225, 244, 220])],
                ],
            },
            ContentNode::paragraph("CANONICAL_AFTER_TABLE"),
        ],
    ));
    doc.nodes.push(ContentNode::row(
        10.,
        vec![
            ContentColumn::new(250., vec![ContentNode::paragraph(tokens("LEFTOWNED_", 45))]),
            ContentColumn::new(
                250.,
                vec![ContentNode::paragraph(tokens("RIGHTOWNED_", 30))],
            ),
        ],
    ));
    doc.nodes.push(ContentNode::List {
        ordered: false,
        items: vec![
            ContentNode::paragraph("LIST_ENTRY_1"),
            ContentNode::paragraph("LIST_ENTRY_2"),
        ],
    });
    doc.nodes
        .push(ContentNode::paragraph("CANONICAL_END_MARKER"));
    let pdf = render_semantic_pdf(doc, &font, RenderOptions::default())?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output, &pdf)?;
    println!("Generated {} bytes: {}", pdf.len(), output.display());
    Ok(())
}
