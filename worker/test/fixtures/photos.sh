#!/bin/sh
# A photo-heavy PDF for the #10 image tests, into $1 (default ./out): photos.pdf.
#   page 1  photo.jpg 2400×1600 Q92, 6 in wide → 400 dpi; also drawn 1 in wide on page 4 (2400 dpi)
#   page 2  flat.png 1800×1200 RGB (FlateDecode) 6 in wide → 300 dpi
#   page 3  alpha.png 1200×1200 RGBA (SMask) 4 in wide → 300 dpi
#   page 4  gray.jpg 1600×1200 gray 6 in wide → 267 dpi; cmyk.jpg 600×400 CMYK
# Needs vips and mutool (the worker image). About 5 MB.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-out}
mkdir -p "$out"
cd "$out"

# Something photo-like: coarse blurred noise for shapes, a little fine noise for texture, per band.
photo() {
  w=$1; h=$2; seed=$3
  for b in 0 1 2; do
    vips gaussnoise c$b.v "$w" "$h" --mean 128 --sigma 90 --seed $((seed + b))
    vips gaussblur c$b.v cg$b.v 24
    vips linear cg$b.v cb$b.v 12 -- -1408 # blurring flattened it to grey: stretch it back out round 128
    vips gaussnoise f$b.v "$w" "$h" --mean 0 --sigma 10 --seed $((seed + b + 10))
    vips gaussblur f$b.v fb$b.v 0.8
    vips add cb$b.v fb$b.v s$b.v
  done
  vips bandjoin "s0.v s1.v s2.v" rgbf.v
  vips cast rgbf.v "$4" uchar
  rm -f c?.v cg?.v cb?.v f?.v fb?.v s?.v rgbf.v
}

photo 2400 1600 1 p1.v
vips copy p1.v "photo.jpg[Q=92]"
photo 1800 1200 2 p2.v
vips copy p2.v flat.png
photo 1200 1200 3 p3.v
vips black a.v 1200 1200 --bands 1
vips linear a.v a1.v 1 200
vips cast a1.v a8.v uchar
vips bandjoin "p3.v a8.v" rgba.v
vips copy rgba.v alpha.png
photo 1600 1200 4 p4.v
vips colourspace p4.v g.v b-w
vips copy g.v "gray.jpg[Q=92]"
photo 600 400 5 p5.v
vips icc_transform p5.v k.v cmyk --input-profile srgb
vips copy k.v "cmyk.jpg[Q=92]"

mutool run "$here/photos.js" photos.pdf photo.jpg flat.png alpha.png gray.jpg cmyk.jpg
rm -f ./*.v photo.jpg flat.png alpha.png gray.jpg cmyk.jpg
