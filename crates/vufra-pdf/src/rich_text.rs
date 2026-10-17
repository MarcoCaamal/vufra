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
    /// Optional font size in points (6..=36); defaults to parent paragraph size.
    pub font_size: Option<f32>,
    /// Optional RGB text color; defaults to black.
    pub color: Option<[u8; 3]>,
    /// Ordered fallback font names, tried for a missing-glyph token.
    pub fallback_fonts: Vec<String>,
}
struct FontSlot {
    font: Font,
    family: String,
    fonts: FontContext,
    source: Vec<u8>,
}
pub struct FontRegistry {
    slots: Vec<FontSlot>,
    lookup: HashMap<String, usize>,
    glyph_cache: HashMap<(usize, char), bool>,
}
impl FontRegistry {
    pub fn new(default: &[u8], extras: &[PdfFontFace]) -> Result<Self, RenderError> {
        if extras.len() > MAX_EXTRA_FONTS {
            return Err(RenderError::InvalidInput("too many font faces"));
        }
        let mut r = Self {
            slots: Vec::new(),
            lookup: HashMap::new(),
            glyph_cache: HashMap::new(),
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
            source: bytes.to_vec(),
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
    fn covers_char(&mut self, index: usize, ch: char) -> Result<bool, RenderError> {
        if ch.is_whitespace() || ch.is_control() {
            return Ok(true);
        }
        if let Some(cached) = self.glyph_cache.get(&(index, ch)) {
            return Ok(*cached);
        }
        let face = ttf_parser::Face::parse(&self.slots[index].source, 0)
            .map_err(|_| RenderError::InvalidFont)?;
        let available = face.glyph_index(ch).is_some_and(|gid| gid.0 != 0);
        self.glyph_cache.insert((index, ch), available);
        Ok(available)
    }
    fn supports_token(&mut self, index: usize, token: &str) -> Result<bool, RenderError> {
        for ch in token.chars() {
            if !self.covers_char(index, ch)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
    fn select_face(
        &mut self,
        primary: usize,
        fallbacks: &[usize],
        token: &str,
    ) -> Result<usize, RenderError> {
        if fallbacks.is_empty() || self.supports_token(primary, token)? {
            return Ok(primary);
        }
        for &fallback in fallbacks {
            if self.supports_token(fallback, token)? {
                return Ok(fallback);
            }
        }
        Err(RenderError::InvalidInput(
            "no font face covers every glyph in rich text token",
        ))
    }
    pub fn font(&self, index: usize) -> Font {
        self.slots[index].font.clone()
    }
    pub(crate) fn line_width(&mut self, line: &RichLine) -> Result<f32, RenderError> {
        let mut width = 0.0_f32;
        for run in line {
            width = width.max(run.x + self.measure(run.font_index, &run.text, run.font_size)?);
        }
        Ok(width)
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
    pub font_size: f32,
    pub color: Option<[u8; 3]>,
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
    for r in runs {
        if let Some(size) = r.font_size
            && (!size.is_finite() || !(6.0..=36.0).contains(&size))
        {
            return Err(RenderError::InvalidInput(
                "rich text font size must be 6..36 points",
            ));
        }
    }
    // Coalesce adjacent runs with identical style before tokenizing so
    // ligatures can be shaped within one word split between API spans.
    let mut canonical: Vec<PdfTextRun> = Vec::new();
    for run in runs {
        if let Some(prev) = canonical.last_mut()
            && prev.font == run.font
            && prev.font_size == run.font_size
            && prev.color == run.color
            && prev.fallback_fonts == run.fallback_fonts
        {
            prev.text.push_str(&run.text);
        } else {
            canonical.push(run.clone());
        }
    }
    let mut lines: Vec<RichLine> = vec![vec![]];
    let mut used = 0.0f32;
    for run in &canonical {
        check_cancel(cancel)?;
        let primary = fonts.resolve(&run.font)?;
        if run.fallback_fonts.len() > 6 {
            return Err(RenderError::InvalidInput("too many fallback font faces"));
        }
        let fallback_indices = run
            .fallback_fonts
            .iter()
            .map(|f| fonts.resolve(f))
            .collect::<Result<Vec<_>, _>>()?;
        let font_size = run.font_size.unwrap_or(style.font_size);
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
                let idx = fonts.select_face(primary, &fallback_indices, &token)?;
                let mut measured = fonts.measure(idx, &token, font_size)?;
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
                    measured = fonts.measure(idx, &trimmed, font_size)?;
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
                    font_size,
                    color: run.color,
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
