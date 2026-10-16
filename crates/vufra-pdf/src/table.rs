//! Multi-column table layout, pagination and rendering for the experimental SDK.
//! Columns have explicit widths in PDF points. Oversized rows may span pages.
use super::{
    CONTENT_HEIGHT, CONTENT_WIDTH, LEFT, RenderError, RenderOptions, TEXT_TOP, measure_text_lines,
};
use krilla::{
    color::rgb,
    geom::{PathBuilder, Point, Rect},
    paint::{Fill, Stroke},
    surface::Surface,
    text::{Font, TextDirection},
};
use parley::{FontContext, LayoutContext};
use vufra_layout::split::{SplitPage, paginate_split_all};

const PADDING_X: f32 = 7.0;
const PADDING_Y: f32 = 6.0;
const MIN_WIDTH: f32 = 36.0;
const MAX_COLUMNS: usize = 12;

/// Width in PDF points (1/72 inch); column headers are repeated on every table page.
#[derive(Debug, Clone)]
pub struct PdfColumn {
    pub header: String,
    pub width: f32,
}

#[derive(Debug, Clone)]
pub struct PdfTable {
    pub columns: Vec<PdfColumn>,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug)]
pub(crate) struct PreparedTable {
    pub columns: Vec<PdfColumn>,
    pub headers: Vec<Vec<String>>,
    pub rows: Vec<PreparedTableRow>,
    pub header_height: f32,
    pub pages: Vec<SplitPage>,
}

#[derive(Debug)]
pub(crate) struct PreparedTableRow {
    pub cells: Vec<Vec<String>>,
    pub line_count: usize,
}

pub(crate) fn prepare_table(
    table: &PdfTable,
    family: &str,
    fonts: &mut FontContext,
    context: &mut LayoutContext<()>,
    options: RenderOptions,
) -> Result<PreparedTable, RenderError> {
    if table.columns.is_empty() || table.columns.len() > MAX_COLUMNS {
        return Err(RenderError::InvalidInput("table requires 1 to 12 columns"));
    }
    if table.rows.len() > 10_000 {
        return Err(RenderError::InvalidInput("too many table rows"));
    }
    let mut width_total = 0.0_f32;
    for column in &table.columns {
        if !column.width.is_finite() || column.width < MIN_WIDTH || column.header.trim().is_empty()
        {
            return Err(RenderError::InvalidInput(
                "invalid table column header or width",
            ));
        }
        width_total += column.width;
        if !width_total.is_finite() || width_total > CONTENT_WIDTH + 0.01 {
            return Err(RenderError::InvalidInput(
                "table columns exceed printable width",
            ));
        }
    }
    let mut headers = Vec::with_capacity(table.columns.len());
    for column in &table.columns {
        headers.push(measure_text_lines(
            &column.header,
            column.width - 2.0 * PADDING_X,
            family,
            fonts,
            context,
            options.text_size,
        )?);
    }
    let header_height = row_height(&headers, options.line_height).max(28.0);
    if header_height >= CONTENT_HEIGHT {
        return Err(RenderError::InvalidInput(
            "table header exceeds printable page",
        ));
    }
    let mut rows = Vec::with_capacity(table.rows.len());
    let mut total_bytes = 0_usize;
    for values in &table.rows {
        if values.len() != table.columns.len() {
            return Err(RenderError::InvalidInput(
                "table row cell count differs from columns",
            ));
        }
        let mut cells = Vec::with_capacity(values.len());
        for (value, column) in values.iter().zip(&table.columns) {
            total_bytes = total_bytes
                .checked_add(value.len())
                .ok_or(RenderError::InvalidInput("table text too large"))?;
            if total_bytes > 4 * 1024 * 1024 {
                return Err(RenderError::InvalidInput("table text too large"));
            }
            cells.push(measure_text_lines(
                value,
                column.width - 2.0 * PADDING_X,
                family,
                fonts,
                context,
                options.text_size,
            )?);
        }
        let line_count = cells.iter().map(Vec::len).max().unwrap_or(1).max(1);
        rows.push(PreparedTableRow { cells, line_count });
    }
    let line_counts = rows.iter().map(|r| r.line_count).collect::<Vec<_>>();
    let pages = paginate_split_all(
        &line_counts,
        CONTENT_HEIGHT,
        header_height,
        options.line_height,
        PADDING_Y,
    )
    .map_err(RenderError::InvalidLayout)?;
    Ok(PreparedTable {
        columns: table.columns.clone(),
        headers,
        rows,
        header_height,
        pages,
    })
}

fn row_height(cells: &[Vec<String>], line_height: f32) -> f32 {
    cells
        .iter()
        .map(|lines| lines.len() as f32 * line_height + 2.0 * PADDING_Y)
        .fold(0.0, f32::max)
}

fn cell_box(surface: &mut Surface<'_>, x: f32, y: f32, w: f32, h: f32, header: bool, stripe: bool) {
    let paint = if header {
        rgb::Color::new(225, 236, 249)
    } else if stripe {
        rgb::Color::new(247, 250, 253)
    } else {
        rgb::Color::new(255, 255, 255)
    };
    surface.set_fill(Some(Fill {
        paint: paint.into(),
        ..Fill::default()
    }));
    surface.set_stroke(Some(Stroke {
        paint: rgb::Color::new(187, 197, 207).into(),
        width: 0.5,
        ..Stroke::default()
    }));
    if let Some(rect) = Rect::from_xywh(x, y, w, h) {
        let mut path = PathBuilder::new();
        path.push_rect(rect);
        if let Some(path) = path.finish() {
            surface.draw_path(&path);
        }
    }
    surface.set_stroke(None);
    surface.set_fill(Some(Fill::default()));
}

pub(crate) fn draw_table_fragment(
    surface: &mut Surface<'_>,
    table: &PreparedTable,
    fragment: &SplitPage,
    font: &Font,
    options: RenderOptions,
) {
    let mut x = LEFT;
    let mut y = TEXT_TOP;
    for (column, header_lines) in table.columns.iter().zip(&table.headers) {
        cell_box(
            surface,
            x,
            y,
            column.width,
            table.header_height,
            true,
            false,
        );
        for (index, line) in header_lines.iter().enumerate() {
            if !line.is_empty() {
                surface.draw_text(
                    Point::from_xy(
                        x + PADDING_X,
                        y + PADDING_Y + options.line_height * (index + 1) as f32 - 3.0,
                    ),
                    font.clone(),
                    options.text_size,
                    line,
                    false,
                    TextDirection::Auto,
                );
            }
        }
        x += column.width;
    }
    y += table.header_height;
    for slice in &fragment.slices {
        let row = &table.rows[slice.row];
        let top_padding = if slice.first { PADDING_Y } else { 0.0 };
        let bottom_padding = if slice.last { PADDING_Y } else { 0.0 };
        let height = (slice.end_line - slice.start_line) as f32 * options.line_height
            + top_padding
            + bottom_padding;
        x = LEFT;
        for (column, lines) in table.columns.iter().zip(&row.cells) {
            cell_box(
                surface,
                x,
                y,
                column.width,
                height,
                false,
                slice.row % 2 == 1,
            );
            for line_index in slice.start_line..slice.end_line {
                if let Some(line) = lines.get(line_index)
                    && !line.is_empty()
                {
                    let local_line = line_index - slice.start_line;
                    surface.draw_text(
                        Point::from_xy(
                            x + PADDING_X,
                            y + top_padding + options.line_height * (local_line + 1) as f32 - 3.0,
                        ),
                        font.clone(),
                        options.text_size,
                        line,
                        false,
                        TextDirection::Auto,
                    );
                }
            }
            x += column.width;
        }
        y += height;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_height_is_tallest_cell_plus_padding() {
        let cells = vec![
            vec!["A".to_string()],
            vec!["B".to_string(), "C".to_string()],
        ];
        assert_eq!(row_height(&cells, 16.0), 44.0);
    }

    #[test]
    fn empty_cell_still_gets_vertical_padding() {
        assert_eq!(row_height(&[vec![]], 16.0), 12.0);
    }
}
