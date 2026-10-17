//! Raster bitmap blocks. PNG (with optional transparency) and JPEG only.
use crate::RenderError;
use krilla::{
    geom::{PathBuilder, Rect, Size, Transform},
    image::Image,
    paint::FillRule,
    surface::Surface,
};

pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TOTAL_IMAGE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 12_000_000;
pub const MAX_TOTAL_IMAGE_PIXELS: u64 = 24_000_000;
pub const MAX_IMAGE_BLOCKS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFit {
    Contain,
    Cover,
}

#[derive(Clone, Debug)]
pub struct PdfImage {
    pub data: Vec<u8>,
    pub width: f32,
    pub height: f32,
    pub fit: ImageFit,
}

/// Validated position and cropping options. No compressed image bytes needed
/// when drawing an image already prepared by the source row.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ImagePlacement {
    pub width: f32,
    pub height: f32,
    pub fit: ImageFit,
}

impl ImagePlacement {
    pub fn validate_box(self, content_width: f32, content_height: f32) -> Result<(), RenderError> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || self.width <= 0.0
            || self.height <= 0.0
            || self.width > content_width
            || self.height > content_height
        {
            return Err(RenderError::InvalidInput(
                "image box exceeds printable area or has invalid dimensions",
            ));
        }
        Ok(())
    }
}

/// Width and height define the content box, never the intrinsic pixel count.
impl PdfImage {
    pub fn validate_box(&self, content_width: f32, content_height: f32) -> Result<(), RenderError> {
        self.placement()
            .validate_box(content_width, content_height)?;
        if self.data.is_empty() || self.data.len() > MAX_IMAGE_BYTES {
            return Err(RenderError::InvalidInput(
                "image must contain 1..8 MiB of PNG or JPEG data",
            ));
        }
        Ok(())
    }
    pub(crate) fn placement(&self) -> ImagePlacement {
        ImagePlacement {
            width: self.width,
            height: self.height,
            fit: self.fit,
        }
    }
    pub fn prepare(&self) -> Result<PreparedImage, RenderError> {
        let image = if self.data.starts_with(b"\x89PNG\r\n\x1a\n") {
            Image::from_png(self.data.clone().into(), true)
        } else if self.data.starts_with(&[0xff, 0xd8, 0xff]) {
            Image::from_jpeg(self.data.clone().into(), true)
        } else {
            return Err(RenderError::InvalidInput(
                "image format must be PNG or JPEG",
            ));
        }
        .map_err(|_| RenderError::InvalidInput("invalid or unsupported PNG/JPEG image"))?;
        let (pixels_w, pixels_h) = image.size();
        if pixels_w == 0
            || pixels_h == 0
            || u64::from(pixels_w) * u64::from(pixels_h) > MAX_IMAGE_PIXELS
        {
            return Err(RenderError::InvalidInput(
                "image pixel dimensions exceed the 12 megapixel limit",
            ));
        }
        Ok(PreparedImage {
            image,
            pixels_w: pixels_w as f32,
            pixels_h: pixels_h as f32,
            pixels: u64::from(pixels_w) * u64::from(pixels_h),
        })
    }
}

pub struct PreparedImage {
    image: Image,
    pixels_w: f32,
    pixels_h: f32,
    pixels: u64,
}

impl PreparedImage {
    pub fn pixel_count(&self) -> u64 {
        self.pixels
    }
    pub(crate) fn draw(
        &self,
        surface: &mut Surface,
        placement: ImagePlacement,
        left: f32,
        top: f32,
    ) -> Result<(), RenderError> {
        let sx = placement.width / self.pixels_w;
        let sy = placement.height / self.pixels_h;
        let scale = match placement.fit {
            ImageFit::Contain => sx.min(sy),
            ImageFit::Cover => sx.max(sy),
        };
        let render_w = self.pixels_w * scale;
        let render_h = self.pixels_h * scale;
        let dx = (placement.width - render_w) / 2.0;
        let dy = (placement.height - render_h) / 2.0;
        let size = Size::from_wh(render_w, render_h).ok_or(RenderError::InvalidInput(
            "image render size must be positive",
        ))?;
        surface.push_transform(&Transform::from_translate(left, top));
        if placement.fit == ImageFit::Cover {
            let rect = Rect::from_xywh(0.0, 0.0, placement.width, placement.height).ok_or(
                RenderError::InvalidInput("invalid image clipping rectangle"),
            )?;
            let mut builder = PathBuilder::new();
            builder.push_rect(rect);
            let path = builder
                .finish()
                .ok_or(RenderError::InvalidInput("invalid clipping path"))?;
            surface.push_clip_path(&path, &FillRule::NonZero);
        }
        surface.push_transform(&Transform::from_translate(dx, dy));
        surface.draw_image(self.image.clone(), size);
        surface.pop();
        if placement.fit == ImageFit::Cover {
            surface.pop();
        }
        surface.pop();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(data: Vec<u8>) -> PdfImage {
        PdfImage {
            data,
            width: 150.0,
            height: 100.0,
            fit: ImageFit::Contain,
        }
    }

    #[test]
    fn image_box_must_fit_printable_area() {
        let valid = sample(vec![1]);
        assert!(valid.validate_box(497.0, 650.0).is_ok());
        let huge = PdfImage {
            width: 1000.0,
            ..valid.clone()
        };
        assert!(huge.validate_box(497.0, 650.0).is_err());
        let nonfinite = PdfImage {
            height: f32::INFINITY,
            ..valid.clone()
        };
        assert!(nonfinite.validate_box(497.0, 650.0).is_err());
        let empty = sample(vec![]);
        assert!(empty.validate_box(497.0, 650.0).is_err());
    }

    #[test]
    fn unsupported_bytes_are_rejected_before_drawing() {
        assert!(sample(vec![1, 2, 3, 4]).prepare().is_err());
        assert!(
            sample(b"\\x89PNG\\r\\n\\x1a\\ninvalid".to_vec())
                .prepare()
                .is_err()
        );
    }
}
