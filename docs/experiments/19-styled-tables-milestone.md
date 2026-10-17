# Unidad 18 — Tablas enriquecidas en cajas

Fecha: 2026-10-17. Estado: prototipo funcional.

## Resumen

- `box.table(rows,{columns})`: agrega tabla real con celdas tipográficas, colores, relleno RGB y PNG/JPEG.
- `tableStyled(rows,{columns})`: atajo para tabla de ancho completo sin decoración exterior ni padding extra.
- `StyledTableCell`: texto, negrita con fuente real, color y fondo, varios rich runs o imagen con tamaño explícito.
- Paginación nativa segura **entre** filas: el encabezado se repite cuando el contenido continúa en otra página y nunca se deja aislado sin al menos una fila.
- Se mantiene intacta la API `table()` anterior con filas fragmentables.

## Ejemplo

```ts
const pdf = await engine.document({page:'Letter'})
  .box({padding:16,border:{width:1,color:'#446688'}}, box=>{
    box.heading('Estado de cuenta',{bold:true});
    box.table([
      [{text:'A001',bold:true}, {runs:[
        {text:'Servicio ',bold:true},{text:'premium'}
      ]}, {text:'$200.00',background:'#E1F4DC'}],
      ['A002','Servicio estándar','$150.00']
    ],{columns:[
      {title:'Folio',width:'25%'},
      {title:'Descripción',width:'50%'},
      {title:'Importe',width:'25%',align:'right'}
    ]});
  })
  .render();
```

## Verificación

Ejecutar `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, `bash scripts/build-native.sh`, `(cd packages/vufra && npm run build && npm test)`; ejemplo `node examples/fluent-styled-tables.mjs REGULAR BOLD artifacts/fluent-styled-tables.pdf`. Revisar `pdfinfo`, `pdffonts`, `pdftotext -raw` y `pdftoppm`.

## Límites

Una fila demasiado alta no se divide; retorna error. Máximo seis columnas (ancho mínimo 60pt), 1000 filas y un tipo de contenido por celda: texto, runs o PNG/JPEG. Sin colspan, rowspan ni tablas anidadas recursivamente.
