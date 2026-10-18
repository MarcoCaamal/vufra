//! Small N-API bridge. Keep all PDF logic inside vufra-pdf.
use napi::{
    Env, Task,
    bindgen_prelude::{AsyncTask, Buffer},
};
use napi_derive::napi;
use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use vufra_pdf::{
    BoxAlign, ContentNode, GraphicKind, ImageFit, MAX_IMAGE_BLOCKS, MAX_IMAGE_BYTES,
    MAX_TOTAL_IMAGE_BYTES, PageGeometry, PdfBlock, PdfBox, PdfBoxItem, PdfBoxTable, PdfFontFace,
    PdfGraphic, PdfImage, PdfPageChrome, PdfRow, PdfRowColumn, PdfRowItem, PdfTextRun,
    RenderOptions, SemanticDocument, TextStyle,
};

#[napi(object)]
pub struct NodeBlock {
    pub kind: String,
    pub text: Option<String>,
    pub runs: Option<Vec<NodeRichRun>>,
    pub image: Option<NodeImage>,
    pub items: Option<Vec<String>>,
    pub ordered: Option<bool>,
    pub keep_with_next: Option<bool>,
    pub graphic: Option<NodeGraphic>,
    pub row: Option<NodeRow>,
    pub box_data: Option<NodeBox>,
    pub level: Option<u32>,
    pub style: Option<NodeTextStyle>,
    pub height: Option<f64>,
}

#[napi(object)]
pub struct NodeRichRun {
    pub text: String,
    pub font: String,
    pub font_size: Option<f64>,
    pub color: Option<String>,
    pub fallback_fonts: Option<Vec<String>>,
}
#[napi(object)]
pub struct NodeFontFace {
    pub name: String,
    pub data: Buffer,
}
#[napi(object)]
pub struct NodeRowItem {
    pub kind: String,
    pub box_data: Option<NodeBox>,
    pub runs: Option<Vec<NodeRichRun>>,
    pub text: Option<String>,
    pub style: Option<NodeTextStyle>,
    pub height: Option<f64>,
    pub image: Option<NodeImage>,
    pub graphic: Option<NodeGraphic>,
}
#[napi(object)]
pub struct NodeCellPadding {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}
#[napi(object)]
pub struct NodeCellLayout {
    pub padding: NodeCellPadding,
    pub center_align: bool,
    pub vertical_align: String,
}
#[napi(object)]
pub struct NodeRowColumn {
    pub width: f64,
    pub right_align: bool,
    pub cell: Option<NodeCellLayout>,
    pub items: Vec<NodeRowItem>,
}
#[napi(object)]
pub struct NodeRow {
    pub gap: f64,
    pub columns: Vec<NodeRowColumn>,
}
#[napi(object)]
pub struct NodeBoxTable {
    pub header: NodeRow,
    pub rows: Vec<NodeRow>,
    pub fills: Vec<Vec<Option<String>>>,
}
#[napi(object)]
pub struct NodeBoxItem {
    pub kind: String,
    pub runs: Option<Vec<NodeRichRun>>,
    pub text: Option<String>,
    pub style: Option<NodeTextStyle>,
    pub color: Option<String>,
    pub height: Option<f64>,
    pub image: Option<NodeImage>,
    pub graphic: Option<NodeGraphic>,
    pub row: Option<NodeRow>,
    pub table_data: Option<NodeBoxTable>,
    pub box_data: Option<NodeBox>,
}
#[napi(object)]
pub struct NodeBox {
    pub width: Option<f64>,
    pub align: String,
    pub padding: f64,
    pub border_width: f64,
    pub radius: f64,
    pub border_color: Option<String>,
    pub background: Option<String>,
    pub keep_together: Option<bool>,
    pub break_before: Option<bool>,
    pub keep_with_next: Option<bool>,
    pub items: Vec<NodeBoxItem>,
}
#[napi(object)]
pub struct NodePageChrome {
    pub header: Option<NodeRow>,
    pub footer: Option<NodeRow>,
    pub first_header: Option<NodeRow>,
    pub first_footer: Option<NodeRow>,
    pub hide_header: Option<bool>,
    pub hide_footer: Option<bool>,
    pub hide_first_header: Option<bool>,
    pub hide_first_footer: Option<bool>,
}

#[napi(object)]
pub struct NodeGraphic {
    pub kind: String,
    pub width: f64,
    pub height: f64,
    pub color: String,
}
#[napi(object)]
pub struct NodeImage {
    pub data: Option<Buffer>,
    pub asset_id: Option<u32>,
    pub width: f64,
    pub height: f64,
    pub fit: String,
}
#[napi(object)]
pub struct NodeTextStyle {
    pub font_size: f64,
    pub line_height: f64,
    pub space_before: f64,
    pub space_after: f64,
}

#[napi(object)]
pub struct NodePage {
    pub width: f64,
    pub height: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
}
impl From<NodePage> for PageGeometry {
    fn from(p: NodePage) -> Self {
        Self {
            width: p.width as f32,
            height: p.height as f32,
            margin_top: p.margin_top as f32,
            margin_bottom: p.margin_bottom as f32,
            margin_left: p.margin_left as f32,
            margin_right: p.margin_right as f32,
        }
    }
}
impl From<NodeTextStyle> for TextStyle {
    fn from(s: NodeTextStyle) -> Self {
        Self {
            font_size: s.font_size as f32,
            line_height: s.line_height as f32,
            space_before: s.space_before as f32,
            space_after: s.space_after as f32,
        }
    }
}

fn to_graphic(g: NodeGraphic) -> napi::Result<PdfGraphic> {
    let kind = match g.kind.as_str() {
        "rule" => GraphicKind::Rule,
        "rectangle" => GraphicKind::Rectangle,
        _ => return Err(napi::Error::from_reason("invalid graphic kind")),
    };
    let b = g.color.as_bytes();
    if b.len() != 7 || b[0] != b'#' || !b[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err(napi::Error::from_reason("graphic color must be #RRGGBB"));
    }
    let mut rgb = [0u8; 3];
    for (i, value) in rgb.iter_mut().enumerate() {
        *value = u8::from_str_radix(&g.color[(1 + i * 2)..(3 + i * 2)], 16)
            .map_err(|_| napi::Error::from_reason("invalid graphic color"))?;
    }
    Ok(PdfGraphic {
        kind,
        width: g.width as f32,
        height: g.height as f32,
        rgb,
    })
}
fn optional_rgb(input: Option<String>) -> napi::Result<Option<[u8; 3]>> {
    input
        .map(|c| {
            if c.len() != 7
                || !c.starts_with('#')
                || !c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(napi::Error::from_reason("box colors must be #RRGGBB"));
            }
            let mut rgb = [0u8; 3];
            for (i, v) in rgb.iter_mut().enumerate() {
                *v = u8::from_str_radix(&c[(1 + i * 2)..(3 + i * 2)], 16)
                    .map_err(|_| napi::Error::from_reason("invalid box RGB color"))?;
            }
            Ok(rgb)
        })
        .transpose()
}
fn to_runs(runs: Vec<NodeRichRun>) -> napi::Result<Vec<PdfTextRun>> {
    runs.into_iter()
        .map(|r| {
            Ok(PdfTextRun {
                text: r.text,
                font: r.font,
                font_size: r.font_size.map(|v| v as f32),
                color: optional_rgb(r.color)?,
                fallback_fonts: r.fallback_fonts.unwrap_or_default(),
            })
        })
        .collect()
}
fn to_box(input: NodeBox, assets: &NativeAssets) -> napi::Result<PdfBox> {
    to_box_depth(input, 0, assets)
}
fn to_box_depth(input: NodeBox, depth: usize, assets: &NativeAssets) -> napi::Result<PdfBox> {
    if depth > 8 {
        return Err(napi::Error::from_reason("nested box depth exceeds 8"));
    }
    let align = match input.align.as_str() {
        "left" => BoxAlign::Left,
        "center" => BoxAlign::Center,
        "right" => BoxAlign::Right,
        _ => {
            return Err(napi::Error::from_reason(
                "box align must be left,center,right",
            ));
        }
    };
    let items = input
        .items
        .into_iter()
        .map(|item| match item.kind.as_str() {
            "text" => Ok(PdfBoxItem::Text {
                text: item
                    .text
                    .ok_or_else(|| napi::Error::from_reason("box text required"))?,
                style: item
                    .style
                    .ok_or_else(|| napi::Error::from_reason("box text style required"))?
                    .into(),
                color: optional_rgb(item.color)?,
            }),
            "rich" => Ok(PdfBoxItem::RichText {
                runs: to_runs(
                    item.runs
                        .ok_or_else(|| napi::Error::from_reason("box rich runs required"))?,
                )?,
                style: item
                    .style
                    .ok_or_else(|| napi::Error::from_reason("box rich style required"))?
                    .into(),
            }),
            "image" => Ok(PdfBoxItem::Image(to_image(
                item.image
                    .ok_or_else(|| napi::Error::from_reason("box image required"))?,
                assets,
            )?)),
            "graphic" => Ok(PdfBoxItem::Graphic(to_graphic(
                item.graphic
                    .ok_or_else(|| napi::Error::from_reason("box graphic required"))?,
            )?)),
            "spacer" => Ok(PdfBoxItem::Spacer(
                item.height
                    .ok_or_else(|| napi::Error::from_reason("box spacer required"))?
                    as f32,
            )),
            "row" => Ok(PdfBoxItem::Row(to_row_depth(
                item.row
                    .ok_or_else(|| napi::Error::from_reason("box row required"))?,
                depth + 1,
                assets,
            )?)),
            "box" => Ok(PdfBoxItem::Box(Box::new(to_box_depth(
                item.box_data
                    .ok_or_else(|| napi::Error::from_reason("nested box payload is required"))?,
                depth + 1,
                assets,
            )?))),
            "table" => {
                let table = item
                    .table_data
                    .ok_or_else(|| napi::Error::from_reason("boxed table required"))?;
                Ok(PdfBoxItem::Table(PdfBoxTable {
                    header: to_row_depth(table.header, depth + 1, assets)?,
                    rows: table
                        .rows
                        .into_iter()
                        .map(|row| to_row_depth(row, depth + 1, assets))
                        .collect::<napi::Result<Vec<_>>>()?,
                    fills: table
                        .fills
                        .into_iter()
                        .map(|colors| {
                            colors
                                .into_iter()
                                .map(optional_rgb)
                                .collect::<napi::Result<Vec<_>>>()
                        })
                        .collect::<napi::Result<Vec<_>>>()?,
                }))
            }
            _ => Err(napi::Error::from_reason("unsupported box item")),
        })
        .collect::<napi::Result<Vec<_>>>()?;
    Ok(PdfBox {
        width: input.width.map(|w| w as f32),
        align,
        padding: input.padding as f32,
        border_width: input.border_width as f32,
        radius: input.radius as f32,
        border_color: optional_rgb(input.border_color)?,
        background: optional_rgb(input.background)?,
        keep_together: input.keep_together.unwrap_or(false),
        break_before: input.break_before.unwrap_or(false),
        keep_with_next: input.keep_with_next.unwrap_or(false),
        items,
    })
}
fn to_row(input: NodeRow, assets: &NativeAssets) -> napi::Result<PdfRow> {
    to_row_depth(input, 0, assets)
}
fn to_row_depth(input: NodeRow, depth: usize, assets: &NativeAssets) -> napi::Result<PdfRow> {
    if depth > 8 {
        return Err(napi::Error::from_reason("nested layout depth exceeds 8"));
    }
    let columns = input
        .columns
        .into_iter()
        .map(|column| {
            let items = column
                .items
                .into_iter()
                .map(|item| match item.kind.as_str() {
                    "box" => Ok(PdfRowItem::Box(Box::new(to_box_depth(
                        item.box_data
                            .ok_or_else(|| napi::Error::from_reason("row box payload required"))?,
                        depth + 1,
                        assets,
                    )?))),
                    "text" => Ok(PdfRowItem::Text {
                        text: item
                            .text
                            .ok_or_else(|| napi::Error::from_reason("row text is required"))?,
                        style: item
                            .style
                            .ok_or_else(|| napi::Error::from_reason("row text style is required"))?
                            .into(),
                    }),
                    "rich" => {
                        Ok(PdfRowItem::RichText {
                            runs: to_runs(item.runs.ok_or_else(|| {
                                napi::Error::from_reason("row rich runs required")
                            })?)?,
                            style: item
                                .style
                                .ok_or_else(|| napi::Error::from_reason("row rich style required"))?
                                .into(),
                        })
                    }
                    "image" => Ok(PdfRowItem::Image(to_image(
                        item.image
                            .ok_or_else(|| napi::Error::from_reason("row image is required"))?,
                        assets,
                    )?)),
                    "graphic" => Ok(PdfRowItem::Graphic(to_graphic(
                        item.graphic
                            .ok_or_else(|| napi::Error::from_reason("row graphic is required"))?,
                    )?)),
                    "spacer" => {
                        Ok(PdfRowItem::Spacer(item.height.ok_or_else(|| {
                            napi::Error::from_reason("row spacer height is required")
                        })? as f32))
                    }
                    _ => Err(napi::Error::from_reason("unsupported item in row column")),
                })
                .collect::<napi::Result<Vec<_>>>()?;
            Ok(PdfRowColumn {
                width: column.width as f32,
                right_align: column.right_align,
                cell: column
                    .cell
                    .map(|layout| {
                        use vufra_pdf::{CellPadding, CellVerticalAlign, TableCellLayout};
                        let vertical_align = match layout.vertical_align.as_str() {
                            "top" => CellVerticalAlign::Top,
                            "center" => CellVerticalAlign::Center,
                            "bottom" => CellVerticalAlign::Bottom,
                            _ => {
                                return Err(napi::Error::from_reason(
                                    "invalid cell vertical alignment",
                                ));
                            }
                        };
                        Ok(TableCellLayout {
                            padding: CellPadding {
                                top: layout.padding.top as f32,
                                right: layout.padding.right as f32,
                                bottom: layout.padding.bottom as f32,
                                left: layout.padding.left as f32,
                            },
                            center_align: layout.center_align,
                            vertical_align,
                        })
                    })
                    .transpose()?,
                items,
            })
        })
        .collect::<napi::Result<Vec<_>>>()?;
    Ok(PdfRow {
        gap: input.gap as f32,
        columns,
    })
}
fn image_bytes(input: &NodeImage, assets: &NativeAssets) -> napi::Result<Arc<Vec<u8>>> {
    match (&input.data, input.asset_id) {
        (Some(data), None) => Ok(Arc::new(data.to_vec())),
        (None, Some(id)) => assets.image_bytes(id),
        _ => Err(napi::Error::from_reason(
            "image must specify exactly one source",
        )),
    }
}
fn image_byte_len(input: &NodeImage, assets: &NativeAssets) -> napi::Result<usize> {
    match (&input.data, input.asset_id) {
        (Some(data), None) => Ok(data.len()),
        (None, Some(id)) => Ok(assets.image_bytes(id)?.len()),
        _ => Err(napi::Error::from_reason(
            "image must specify exactly one source",
        )),
    }
}
fn to_image(input: NodeImage, assets: &NativeAssets) -> napi::Result<PdfImage> {
    let bytes = image_bytes(&input, assets)?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(napi::Error::from_reason(
            "image bytes exceed the 8 MiB limit",
        ));
    }
    let fit = match input.fit.as_str() {
        "contain" => ImageFit::Contain,
        "cover" => ImageFit::Cover,
        _ => {
            return Err(napi::Error::from_reason(
                "Image fit must be contain or cover",
            ));
        }
    };
    Ok(PdfImage {
        data: bytes,
        width: input.width as f32,
        height: input.height as f32,
        fit,
    })
}

fn preflight_image(
    image: &NodeImage,
    count: &mut usize,
    total: &mut usize,
    assets: &NativeAssets,
) -> napi::Result<()> {
    let len = image_byte_len(image, assets)?;
    if len == 0 || len > MAX_IMAGE_BYTES {
        return Err(napi::Error::from_reason(
            "image bytes exceed the 8 MiB limit",
        ));
    }
    *count += 1;
    *total = total
        .checked_add(len)
        .ok_or_else(|| napi::Error::from_reason("too many image bytes"))?;
    if *count > MAX_IMAGE_BLOCKS || *total > MAX_TOTAL_IMAGE_BYTES {
        return Err(napi::Error::from_reason(
            "too many images or too much image data",
        ));
    }
    Ok(())
}
fn preflight_row_images(
    row: &NodeRow,
    count: &mut usize,
    total: &mut usize,
    assets: &NativeAssets,
) -> napi::Result<()> {
    preflight_row_depth(row, count, total, 0, assets)
}
fn preflight_row_depth(
    row: &NodeRow,
    count: &mut usize,
    total: &mut usize,
    depth: usize,
    assets: &NativeAssets,
) -> napi::Result<()> {
    if depth > 8 {
        return Err(napi::Error::from_reason("nested layout depth exceeds 8"));
    }
    for column in &row.columns {
        for item in &column.items {
            if let Some(image) = &item.image {
                preflight_image(image, count, total, assets)?;
            }
            if let Some(boxed) = &item.box_data {
                preflight_box_images(boxed, count, total, depth + 1, assets)?;
            }
        }
    }
    Ok(())
}
fn preflight_box_images(
    boxed: &NodeBox,
    count: &mut usize,
    bytes: &mut usize,
    depth: usize,
    assets: &NativeAssets,
) -> napi::Result<()> {
    if depth > 8 {
        return Err(napi::Error::from_reason("nested box depth exceeds 8"));
    }
    for item in &boxed.items {
        if let Some(image) = &item.image {
            preflight_image(image, count, bytes, assets)?;
        }
        if let Some(row) = &item.row {
            preflight_row_depth(row, count, bytes, depth + 1, assets)?;
        }
        if let Some(table) = &item.table_data {
            preflight_row_depth(&table.header, count, bytes, depth + 1, assets)?;
            for row in &table.rows {
                preflight_row_depth(row, count, bytes, depth + 1, assets)?;
            }
        }
        if let Some(child) = &item.box_data {
            preflight_box_images(child, count, bytes, depth + 1, assets)?;
        }
    }
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn parse_document(
    title: String,
    blocks: Vec<NodeBlock>,
    page: Option<NodePage>,
    assets: &NativeAssets,
    chrome: Option<NodePageChrome>,
) -> napi::Result<SemanticDocument> {
    // Verify image budgets recursively before copying native input buffers.
    // Covers regular images, rows, and decorated boxes (including row items
    // within a boxed content block).
    let mut count = 0usize;
    let mut bytes = 0usize;
    {
        for block in &blocks {
            if let Some(image) = &block.image {
                preflight_image(image, &mut count, &mut bytes, assets)?;
            }
            if let Some(row) = &block.row {
                preflight_row_images(row, &mut count, &mut bytes, assets)?;
            }
            if let Some(boxed) = &block.box_data {
                preflight_box_images(boxed, &mut count, &mut bytes, 0, assets)?;
            }
        }
    }
    if let Some(c) = &chrome {
        for row in [&c.header, &c.footer, &c.first_header, &c.first_footer]
            .into_iter()
            .flatten()
        {
            preflight_row_images(row, &mut count, &mut bytes, assets)?;
        }
        if count > MAX_IMAGE_BLOCKS || bytes > MAX_TOTAL_IMAGE_BYTES {
            return Err(napi::Error::from_reason("page bands exceed image budget"));
        }
    }
    let doc = SemanticDocument {
        title,
        page: page.map(Into::into),
        chrome: chrome
            .map(|c| {
                Ok::<PdfPageChrome, napi::Error>(PdfPageChrome {
                    header: c.header.map(|r| to_row(r, assets)).transpose()?,
                    footer: c.footer.map(|r| to_row(r, assets)).transpose()?,
                    first_header: c.first_header.map(|r| to_row(r, assets)).transpose()?,
                    first_footer: c.first_footer.map(|r| to_row(r, assets)).transpose()?,
                    hide_header: c.hide_header.unwrap_or(false),
                    hide_footer: c.hide_footer.unwrap_or(false),
                    hide_first_header: c.hide_first_header.unwrap_or(false),
                    hide_first_footer: c.hide_first_footer.unwrap_or(false),
                })
            })
            .transpose()?,
        fonts: assets.fonts.clone(),
        nodes: blocks
            .into_iter()
            .map(|item| match item.kind.as_str() {
                "image" if item.image.is_some() && item.text.is_none() => Ok(PdfBlock::Image(
                    to_image(item.image.expect("image checked"), assets)?,
                )),
                "page-break" if item.row.is_none() && item.text.is_none() => {
                    Ok(PdfBlock::PageBreak)
                }
                "box" if item.box_data.is_some() => Ok(PdfBlock::Box(to_box(
                    item.box_data.expect("box checked"),
                    assets,
                )?)),
                "row" if item.row.is_some() => Ok(PdfBlock::Row(to_row(
                    item.row.expect("row checked"),
                    assets,
                )?)),
                "list" if item.items.is_some() && item.image.is_none() => Ok(PdfBlock::List {
                    items: item.items.expect("items checked"),
                    ordered: item.ordered.unwrap_or(false),
                }),
                "graphic" if item.graphic.is_some() && item.image.is_none() => Ok(
                    PdfBlock::Graphic(to_graphic(item.graphic.expect("graphic checked"))?),
                ),
                "rich-paragraph"
                    if item.runs.is_some() && item.style.is_some() && item.text.is_none() =>
                {
                    Ok(PdfBlock::RichParagraph {
                        runs: item
                            .runs
                            .expect("runs checked")
                            .into_iter()
                            .map(|r| {
                                Ok(PdfTextRun {
                                    text: r.text,
                                    font: r.font,
                                    font_size: r.font_size.map(|s| s as f32),
                                    fallback_fonts: r.fallback_fonts.unwrap_or_default(),
                                    color: r
                                        .color
                                        .map(|c| {
                                            let b = c.as_bytes();
                                            if b.len() != 7
                                                || b[0] != b'#'
                                                || !b[1..].iter().all(u8::is_ascii_hexdigit)
                                            {
                                                return Err(napi::Error::from_reason(
                                                    "rich text color must be #RRGGBB",
                                                ));
                                            }
                                            let mut rgb = [0u8; 3];
                                            for (i, v) in rgb.iter_mut().enumerate() {
                                                *v = u8::from_str_radix(
                                                    &c[(1 + 2 * i)..(3 + 2 * i)],
                                                    16,
                                                )
                                                .map_err(|_| {
                                                    napi::Error::from_reason(
                                                        "invalid rich text color",
                                                    )
                                                })?;
                                            }
                                            Ok(rgb)
                                        })
                                        .transpose()?,
                                })
                            })
                            .collect::<napi::Result<Vec<_>>>()?,
                        style: item.style.expect("style checked").into(),
                        keep_with_next: item.keep_with_next.unwrap_or(false),
                    })
                }
                "paragraph" if item.text.is_some() => {
                    Ok(PdfBlock::Paragraph(item.text.unwrap_or_default()))
                }
                "heading" if item.text.is_some() => Ok(PdfBlock::Heading {
                    text: item.text.unwrap_or_default(),
                    keep_with_next: item.keep_with_next.unwrap_or(true),
                    level: item
                        .level
                        .and_then(|v| u8::try_from(v).ok())
                        .ok_or_else(|| napi::Error::from_reason("Invalid heading level"))?,
                }),
                "styled-paragraph" if item.text.is_some() && item.style.is_some() => {
                    Ok(PdfBlock::StyledParagraph {
                        text: item.text.unwrap_or_default(),
                        style: item.style.expect("style checked").into(),
                    })
                }
                "spacer" if item.height.is_some() && item.text.is_none() => Ok(PdfBlock::Spacer {
                    height: item.height.unwrap_or_default() as f32,
                }),
                _ => Err(napi::Error::from_reason(
                    "Invalid flow block kind or payload",
                )),
            })
            .collect::<napi::Result<Vec<_>>>()?
            .into_iter()
            .map(ContentNode::from)
            .collect(),
    };
    Ok(doc)
}

/// Snapshot caller-mutable bytes exactly once into a reusable immutable
/// native font resource. JavaScript receives no mutable view of its Arc.
#[napi]
pub struct NativeFont {
    bytes: Arc<Vec<u8>>,
}
#[napi]
impl NativeFont {
    #[napi(constructor)]
    pub fn new(data: Buffer) -> napi::Result<Self> {
        if data.is_empty() || data.len() > 12 * 1024 * 1024 {
            return Err(napi::Error::from_reason(
                "native font resource needs 1..12 MiB of bytes",
            ));
        }
        Ok(Self {
            bytes: Arc::new(data.to_vec()),
        })
    }

    #[napi(getter)]
    pub fn byte_length(&self) -> u32 {
        self.bytes.len() as u32
    }
}

#[derive(Default)]
struct ImageCache {
    entries: Vec<Arc<Vec<u8>>>,
    // Fingerprint limits full byte comparisons to possible hash matches.
    // Bytes are still compared exactly, so collisions cannot alias assets.
    by_hash: HashMap<u64, Vec<usize>>,
    resident_bytes: usize,
}
impl ImageCache {
    fn fingerprint(data: &[u8]) -> u64 {
        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        hasher.finish()
    }
    fn register(&mut self, data: &[u8]) -> i32 {
        let hash = Self::fingerprint(data);
        if let Some(positions) = self.by_hash.get(&hash) {
            for &index in positions {
                if self.entries[index].as_slice() == data {
                    return index as i32;
                }
            }
        }
        if self.entries.len() >= 256
            || self.resident_bytes.saturating_add(data.len()) > 64 * 1024 * 1024
        {
            return -1;
        }
        let index = self.entries.len();
        self.entries.push(Arc::new(data.to_vec()));
        self.by_hash.entry(hash).or_default().push(index);
        self.resident_bytes += data.len();
        index as i32
    }
    fn clear(&mut self) {
        self.entries.clear();
        self.by_hash.clear();
        self.resident_bytes = 0;
    }
}
/// Per-factory asset store. Fonts are immutable and images are deduplicated
/// by exact byte equality (never hash-only), with bounded resident memory.
#[napi]
pub struct NativeAssets {
    fonts: Vec<PdfFontFace>,
    images: Mutex<ImageCache>,
}
#[napi]
impl NativeAssets {
    #[napi(constructor)]
    pub fn new(faces: Vec<NodeFontFace>) -> napi::Result<Self> {
        if faces.len() > 6 {
            return Err(napi::Error::from_reason(
                "font faces exceed count or byte limits",
            ));
        }
        let mut total = 0usize;
        let mut seen = std::collections::HashSet::new();
        let fonts = faces
            .into_iter()
            .map(|f| {
                total = total
                    .checked_add(f.data.len())
                    .ok_or_else(|| napi::Error::from_reason("font byte overflow"))?;
                if f.data.is_empty()
                    || f.data.len() > 12 * 1024 * 1024
                    || total > 30 * 1024 * 1024
                    || f.name == "regular"
                    || f.name.is_empty()
                    || f.name.len() > 24
                    || !f
                        .name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                    || !seen.insert(f.name.clone())
                {
                    return Err(napi::Error::from_reason(
                        "invalid font face or font byte budget",
                    ));
                }
                Ok(PdfFontFace {
                    name: f.name,
                    data: Arc::new(f.data.to_vec()),
                })
            })
            .collect::<napi::Result<Vec<_>>>()?;
        Ok(Self {
            fonts,
            images: Mutex::new(ImageCache::default()),
        })
    }

    /// Drop a temporary bundle after synchronous NAPI parsing. Async tasks
    /// already own Arc clones and never borrow resources from this object.
    /// Persistent factory bundles must not call this.
    #[napi]
    pub fn release(&mut self) {
        self.fonts.clear();
        if let Ok(mut images) = self.images.lock() {
            images.clear();
        }
    }

    /// -1 means the bounded cache is full and the caller should embed inline
    /// bytes for this one document. Previously registered IDs remain stable.
    #[napi]
    pub fn register_image(&self, data: Buffer) -> napi::Result<i32> {
        if data.is_empty() || data.len() > MAX_IMAGE_BYTES {
            return Err(napi::Error::from_reason(
                "image bytes exceed the 8 MiB limit",
            ));
        }
        let mut cache = self
            .images
            .lock()
            .map_err(|_| napi::Error::from_reason("image cache poisoned"))?;
        Ok(cache.register(data.as_ref()))
    }
}
impl NativeAssets {
    fn image_bytes(&self, id: u32) -> napi::Result<Arc<Vec<u8>>> {
        self.images
            .lock()
            .map_err(|_| napi::Error::from_reason("image cache poisoned"))?
            .entries
            .get(id as usize)
            .cloned()
            .ok_or_else(|| napi::Error::from_reason("invalid image asset id"))
    }
}
/// Synchronous render of the canonical authored document.
#[napi]
pub fn render_pdf_native(
    title: String,
    blocks: Vec<NodeBlock>,
    font_data: &NativeFont,
    page: Option<NodePage>,
    assets: &NativeAssets,
    chrome: Option<NodePageChrome>,
) -> napi::Result<Buffer> {
    let doc = parse_document(title, blocks, page, assets, chrome)?;
    vufra_pdf::render_semantic_pdf(doc, Arc::clone(&font_data.bytes), RenderOptions::default())
        .map(Buffer::from)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Cancellation flag remains accessible from the Node event loop while the worker runs.
#[napi]
pub struct PdfCancellationToken {
    cancelled: Arc<AtomicBool>,
}
impl Default for PdfCancellationToken {
    fn default() -> Self {
        Self::new()
    }
}
#[napi]
impl PdfCancellationToken {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
    #[napi(getter)]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

#[napi(object)]
pub struct NativePdfResult {
    pub pdf: Buffer,
    pub render_ms: f64,
}

/// Owned input, moved off the JS thread before CPU-heavy layout and rendering.
pub struct PdfRenderTask {
    doc: Option<SemanticDocument>,
    font_data: Option<Arc<Vec<u8>>>,
    cancelled: Arc<AtomicBool>,
}
impl Task for PdfRenderTask {
    type Output = (Vec<u8>, f64);
    type JsValue = NativePdfResult;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let started = Instant::now();
        let doc = self
            .doc
            .take()
            .ok_or_else(|| napi::Error::from_reason("native render task already consumed"))?;
        let bytes = vufra_pdf::render_semantic_pdf_with_cancel(
            doc,
            self.font_data
                .take()
                .ok_or_else(|| napi::Error::from_reason("native font task already consumed"))?,
            RenderOptions::default(),
            &self.cancelled,
        )
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        Ok((bytes, started.elapsed().as_secs_f64() * 1000.0))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(NativePdfResult {
            pdf: Buffer::from(output.0),
            render_ms: output.1,
        })
    }
}

/// NAPI worker executes only the owned semantic document.
#[napi]
pub fn render_pdf_async_native(
    title: String,
    blocks: Vec<NodeBlock>,
    font_data: &NativeFont,
    page: Option<NodePage>,
    token: Option<&PdfCancellationToken>,
    assets: &NativeAssets,
    chrome: Option<NodePageChrome>,
) -> napi::Result<AsyncTask<PdfRenderTask>> {
    let doc = parse_document(title, blocks, page, assets, chrome)?;
    Ok(AsyncTask::new(PdfRenderTask {
        doc: Some(doc),
        font_data: Some(Arc::clone(&font_data.bytes)),
        cancelled: token.map_or_else(|| Arc::new(AtomicBool::new(false)), |t| t.cancelled.clone()),
    }))
}
