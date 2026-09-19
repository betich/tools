#!/bin/sh
# Generates the #8 analysis fixtures into $1 (default: ./out). Needs the
# worker image's toolchain (mutool, vips, gs, qpdf); run it inside
# tools-pdf-worker. Nothing binary is checked in — together they are ~2 MB.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-out}
mkdir -p "$out"
cd "$out"

# A photo-like 1200×800 JPEG and a 300×300 PNG with an alpha channel.
vips gaussnoise noise.v 1200 800 --mean 128 --sigma 40
vips gaussblur noise.v blur.v 4
vips bandjoin "blur.v blur.v blur.v" rgb.v
vips copy rgb.v "photo.jpg[Q=80]"
vips black a.v 300 300 --bands 1
vips linear a.v alphaband.v 1 180
vips bandjoin "blur.v blur.v blur.v" rgb2.v
vips extract_area rgb2.v rgb300.v 0 0 300 300
vips bandjoin "rgb300.v alphaband.v" rgba.v
vips cast rgba.v rgba8.v uchar
vips copy rgba8.v alpha.png

# A greyscale A4 page at 300 dpi.
vips gaussnoise pnoise.v 2480 3508 --mean 235 --sigma 6
vips cast pnoise.v page8.v uchar
vips copy page8.v "page.jpg[Q=40]"

mutool run "$here/deck.js" deck.pdf photo.jpg alpha.png
mutool run "$here/scan.js" scan.pdf page.jpg 3
# Ghostscript rewrites the deck the way most "save as PDF" paths do: subset
# fonts, a classic xref table, no object streams, flags dropped.
gs -q -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -dEmbedAllFonts=true -dSubsetFonts=true -o deck-gs.pdf \
  -c "<< /NeverEmbed [ ] >> setdistillerparams" -f deck.pdf
# Encrypted with a user password: nothing past the dictionaries can be read.
qpdf --encrypt --user-password=secret --owner-password=owner --bits=256 -- deck.pdf locked.pdf

rm -f ./*.v photo.jpg alpha.png page.jpg
ls -l ./*.pdf
