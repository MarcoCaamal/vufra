//! Validated document geometry and text styling for ordered-flow documents.
//! All dimensions are in PDF points, never pixels.
use crate::RenderError;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageGeometry {
    pub width: f32,
    pub height: f32,
    pub margin_top: f32,
    pub margin_bottom: f32,
    pub margin_left: f32,
    pub margin_right: f32,
}
impl Default for PageGeometry {
    fn default() -> Self {
        Self::a4()
    }
}
impl PageGeometry {
    pub const fn a4() -> Self {
        Self {
            width: 595.0,
            height: 842.0,
            margin_top: 120.0,
            margin_bottom: 72.0,
            margin_left: 49.0,
            margin_right: 49.0,
        }
    }
    pub const fn letter() -> Self {
        Self {
            width: 612.0,
            height: 792.0,
            margin_top: 120.0,
            margin_bottom: 72.0,
            margin_left: 49.0,
            margin_right: 49.0,
        }
    }
    pub fn content_width(self) -> f32 {
        self.width - self.margin_left - self.margin_right
    }
    pub fn content_height(self) -> f32 {
        self.height - self.margin_top - self.margin_bottom
    }
    pub fn validate(self) -> Result<(), RenderError> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || !(250.0..=2000.0).contains(&self.width)
            || !(250.0..=2000.0).contains(&self.height)
            || !self.margin_top.is_finite()
            || !self.margin_bottom.is_finite()
            || !self.margin_left.is_finite()
            || !self.margin_right.is_finite()
            || self.margin_top < 110.0
            || self.margin_bottom < 50.0
            || self.margin_left < 20.0
            || self.margin_right < 20.0
            || self.content_width() < 100.0
            || self.content_height() < 100.0
        {
            return Err(RenderError::InvalidInput(
                "invalid page geometry or margins",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextStyle {
    pub font_size: f32,
    pub line_height: f32,
    pub space_before: f32,
    pub space_after: f32,
}
impl TextStyle {
    pub fn paragraph() -> Self {
        Self {
            font_size: 11.0,
            line_height: 16.0,
            space_before: 17.0,
            space_after: 9.0,
        }
    }
    pub fn heading(level: u8) -> Result<Self, RenderError> {
        match level {
            1 => Ok(Self {
                font_size: 21.0,
                line_height: 30.0,
                space_before: 20.0,
                space_after: 10.0,
            }),
            2 => Ok(Self {
                font_size: 17.0,
                line_height: 25.0,
                space_before: 17.0,
                space_after: 8.0,
            }),
            3 => Ok(Self {
                font_size: 14.0,
                line_height: 21.0,
                space_before: 16.0,
                space_after: 7.0,
            }),
            _ => Err(RenderError::InvalidInput("heading level must be 1, 2 or 3")),
        }
    }
    pub fn validate(self, page_height: f32) -> Result<(), RenderError> {
        if !self.font_size.is_finite()
            || !self.line_height.is_finite()
            || !self.space_before.is_finite()
            || !self.space_after.is_finite()
            || !(6.0..=36.0).contains(&self.font_size)
            || self.line_height < self.font_size
            || self.line_height > 60.0
            || self.space_before < 0.0
            || self.space_after < 0.0
            || self.line_height + self.space_before > page_height
        {
            return Err(RenderError::InvalidInput("invalid paragraph style"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sizes_and_margin_validation() {
        assert!(PageGeometry::a4().validate().is_ok());
        assert!(PageGeometry::letter().validate().is_ok());
        assert_eq!(PageGeometry::a4().content_height(), 650.0);
        assert_eq!(PageGeometry::letter().content_height(), 600.0);
        assert!(
            PageGeometry {
                margin_right: 300.0,
                ..PageGeometry::a4()
            }
            .validate()
            .is_ok()
        );
        assert!(
            PageGeometry {
                margin_top: f32::NAN,
                ..PageGeometry::a4()
            }
            .validate()
            .is_err()
        );
        assert!(
            PageGeometry {
                width: 210.0,
                ..PageGeometry::a4()
            }
            .validate()
            .is_err()
        );
        assert!(
            PageGeometry {
                margin_right: 580.0,
                ..PageGeometry::a4()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn styles_are_bounded() {
        assert_eq!(TextStyle::heading(1).unwrap().font_size, 21.0);
        assert!(TextStyle::heading(4).is_err());
        assert!(
            TextStyle {
                font_size: f32::NAN,
                ..TextStyle::paragraph()
            }
            .validate(650.0)
            .is_err()
        );
        assert!(
            TextStyle {
                line_height: 9.0,
                ..TextStyle::paragraph()
            }
            .validate(650.0)
            .is_err()
        );
    }
}
