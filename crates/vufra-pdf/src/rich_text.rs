//! Explicit named font faces and positioned inline rich text.
use crate::{RenderError, TextStyle, check_cancel};
use krilla::text::Font;
use parley::{
    FontContext, FontFamily, FontFamilyName, Layout, LayoutContext, StyleProperty,
    fontique::{Blob, Collection, CollectionOptions, SourceCache},
};
use std::{
    borrow::Cow,
    collections::HashMap,
    sync::{Arc, atomic::AtomicBool},
};
pub const MAX_EXTRA_FONTS: usize = 6;
pub const MAX_EXTRA_FONT_BYTES: usize = 30 * 1024 * 1024;
pub const MAX_FONT_FACE_BYTES: usize = 12 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct PdfFontFace {
    pub name: String,
    pub data: Vec<u8>,
}
#[derive(Clone, Debug)]
pub struct PdfTextRun {
    pub text: String,
    pub font: String,
}
struct FontSlot {
    font: Font,
    family: String,
    fonts: FontContext,
}
pub struct FontRegistry {
    slots: Vec<FontSlot>,
    lookup: HashMap<String, usize>,
}
impl FontRegistry {
    pub fn new(default: &[u8], extras: &[PdfFontFace]) -> Result<Self, RenderError> {
        if extras.len() > MAX_EXTRA_FONTS {
            return Err(RenderError::InvalidInput("too many font faces"));
        }
        let mut r = Self {
            slots: Vec::new(),
            lookup: HashMap::new(),
        };
        r.add("regular", default)?;
        let mut total = 0usize;
        for extra in extras {
            total = total
                .checked_add(extra.data.len())
                .ok_or(RenderError::InvalidInput("font byte budget exceeded"))?;
            if total > MAX_EXTRA_FONT_BYTES || extra.data.len() > MAX_FONT_FACE_BYTES {
                return Err(RenderError::InvalidInput("font byte budget exceeded"));
            }
            r.add(&extra.name, &extra.data)?;
        }
        Ok(r)
    }
    fn add(&mut self, name: &str, bytes: &[u8]) -> Result<(), RenderError> {
        if name.is_empty()
            || name.len() > 24
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || self.lookup.contains_key(name)
        {
            return Err(RenderError::InvalidInput(
                "font face name must be unique ASCII identifier",
            ));
        }
        let font = Font::new(bytes.to_vec().into(), 0).ok_or(RenderError::InvalidFont)?;
        let mut fonts = FontContext {
            collection: Collection::new(CollectionOptions {
                shared: false,
                system_fonts: false,
            }),
            source_cache: SourceCache::default(),
        };
        let registered = fonts
            .collection
            .register_fonts(Blob::new(Arc::new(bytes.to_vec())), None);
        let id = registered.first().ok_or(RenderError::InvalidFont)?.0;
        let family = fonts
            .collection
            .family_name(id)
            .ok_or(RenderError::InvalidFont)?
            .to_string();
        self.lookup.insert(name.to_owned(), self.slots.len());
        self.slots.push(FontSlot {
            font,
            family,
            fonts,
        });
        Ok(())
    }
    pub fn resolve(&self, name: &str) -> Result<usize, RenderError> {
        self.lookup
            .get(name)
            .copied()
            .ok_or(RenderError::InvalidInput(
                "rich text references unknown font face",
            ))
    }
    pub fn font(&self, index: usize) -> Font {
        self.slots[index].font.clone()
    }
    fn measure(&mut self, index: usize, text: &str, size: f32) -> Result<f32, RenderError> {
        let face = &mut self.slots[index];
        let mut context: LayoutContext<()> = LayoutContext::new();
        let mut builder = context.ranged_builder(&mut face.fonts, text, 1.0, false);
        builder.push_default(StyleProperty::FontSize(size));
        builder.push_default(StyleProperty::FontFamily(FontFamily::Single(
            FontFamilyName::Named(Cow::Owned(face.family.clone())),
        )));
        let mut layout: Layout<()> = builder.build(text);
        layout.break_all_lines(None);
        Ok(layout.full_width())
    }
}
#[derive(Clone)]
pub struct PositionedRun {
    pub text: String,
    pub x: f32,
    pub font_index: usize,
}
pub type RichLine = Vec<PositionedRun>;

pub fn prepare_rich(
    runs: &[PdfTextRun],
    style: TextStyle,
    width: f32,
    fonts: &mut FontRegistry,
    cancel: &AtomicBool,
) -> Result<Vec<RichLine>, RenderError> {
    if runs.is_empty()
        || runs.len() > 1000
        || runs
            .iter()
            .any(|r| r.text.is_empty() || r.text.contains('\0'))
    {
        return Err(RenderError::InvalidInput(
            "rich paragraph requires 1..1000 nonempty runs",
        ));
    }
    let mut lines: Vec<RichLine> = vec![vec![]];
    let mut used = 0.0f32;
    for run in runs {
        check_cancel(cancel)?;
        let idx = fonts.resolve(&run.font)?;
        for (paragraph_index, paragraph) in run.text.split('\n').enumerate() {
            if paragraph_index > 0 {
                lines.push(vec![]);
                used = 0.0;
            }
            for chunk in paragraph.split_inclusive([' ', '\t']) {
                check_cancel(cancel)?;
                let content = chunk.replace('\t', " ");
                let token = if used == 0.0 {
                    content.trim_start_matches(' ').to_owned()
                } else {
                    content
                };
                if token.is_empty() {
                    continue;
                }
                let mut measured = fonts.measure(idx, &token, style.font_size)?;
                if !measured.is_finite() || measured > width + 0.01 {
                    return Err(RenderError::InvalidInput(
                        "rich text unbreakable token exceeds printable width",
                    ));
                }
                let (text, x) = if used > 0.0 && used + measured > width + 0.01 {
                    lines.push(vec![]);
                    used = 0.0;
                    let trimmed = token.trim_start_matches(' ').to_owned();
                    if trimmed.is_empty() {
                        continue;
                    }
                    measured = fonts.measure(idx, &trimmed, style.font_size)?;
                    (trimmed, 0.0)
                } else {
                    (token, used)
                };
                if measured > width + 0.01 {
                    return Err(RenderError::InvalidInput(
                        "rich text unbreakable token exceeds printable width",
                    ));
                }
                lines.last_mut().expect("initial line").push(PositionedRun {
                    text,
                    x,
                    font_index: idx,
                });
                used += measured;
            }
        }
    }
    if lines.len() > 40_000 {
        return Err(RenderError::InvalidInput("too many rich lines"));
    }
    Ok(lines)
}
