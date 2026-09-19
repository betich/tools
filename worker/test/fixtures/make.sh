#!/bin/sh
# Generates the #8 analysis and #9/#11 compress fixtures into $1 (default: ./out). Needs the
# worker image's toolchain (mutool, vips, gs, qpdf, bun); run it inside
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
# Uncompressed, with duplicates, metadata, extras and annotations for the compress passes (#9).
mutool run "$here/bloated.js" bloated.pdf photo.jpg
# Two whole Sarabun fonts (Thai + Latin) with a few glyphs used, for font subsetting (#11).
bun "$here/thai.ts" thai.pdf
# Encrypted with a user password: nothing past the dictionaries can be read.
qpdf --encrypt --user-password=secret --owner-password=owner --bits=256 -- deck.pdf locked.pdf

# #15 special inputs.
# Signed for real: a self-signed certificate (CN "Test Signer"), and a field
# `mutool sign` fills. The signer's name lives only in the certificate.
mutool run "$here/special.js" sigfield sigfield.pdf
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 \
  -subj "/CN=Test Signer/O=Fixtures" 2>/dev/null
openssl pkcs12 -export -inkey key.pem -in cert.pem -out cert.pfx -passout pass:fixture
field=$(mutool show sigfield.pdf grep | sed -n 's/^\([0-9]*\) 0 obj.*\/FT\/Sig.*/\1/p' | head -n 1)
mutool sign -s cert.pfx -P fixture -o signed.pdf sigfield.pdf "$field" >/dev/null
# PDF/A-2b as Ghostscript writes it (XMP identification in attribute form).
gs -q -dSAFER -dBATCH -dNOPAUSE -dPDFA=2 -dPDFACompatibilityPolicy=1 -sColorConversionStrategy=RGB \
  -sDEVICE=pdfwrite -o pdfa.pdf sigfield.pdf
mutool run "$here/special.js" tagged tagged.pdf
# Damaged twice over: every xref offset shifted by junk after the header (the
# objects are fine), and the file cut off mid-object (they are not).
head -c 15 sigfield.pdf > shifted.pdf
printf '%%junkjunkjunk\n' >> shifted.pdf
tail -c +16 sigfield.pdf >> shifted.pdf
size=$(wc -c < sigfield.pdf)
head -c $((size * 6 / 10)) sigfield.pdf > truncated.pdf

rm -f ./*.v photo.jpg alpha.png page.jpg key.pem cert.pem cert.pfx
ls -l ./*.pdf
