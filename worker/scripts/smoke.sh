#!/bin/sh
# Prints the version of every native tool the worker shells out to; exits
# non-zero if any is missing. Run inside the image:
#   docker run --rm --entrypoint sh tools-pdf-worker worker/scripts/smoke.sh
fail=0
check() {
  name=$1
  shift
  if out=$("$@" 2>&1 | grep -v '^\s*$' | head -n 1) && [ -n "$out" ]; then
    printf '%-14s %s\n' "$name" "$out"
  else
    printf '%-14s MISSING (%s)\n' "$name" "$*"
    fail=1
  fi
}

check mutool       mutool -v
check "mutool run" sh -c 'echo "print(\"mujs ok\")" > /tmp/smoke.js && mutool run /tmp/smoke.js'
check qpdf         qpdf --version
check gs           gs --version
check vips         vips --version
check cjpeg        sh -c 'cjpeg -version 2>&1 | grep -i mozjpeg'
check opj_compress sh -c 'opj_compress -h 2>&1 | grep -i "openjp2 library"'
check cjxl         cjxl --version
# The metric tools have no version flag; the libjxl tag they were built from is recorded beside them.
check ssimulacra2  sh -c 'ssimulacra2 2>&1 | grep -q Usage && echo "libjxl $(cat /opt/jxl/VERSION)"'
check butteraugli  sh -c 'butteraugli 2>&1 | grep -q Usage && echo "libjxl $(cat /opt/jxl/VERSION)"'
check zopfli       sh -c 'zopfli -h 2>&1 | grep -q Usage && dpkg-query -W -f="zopfli \${Version} (deb)" zopfli'
check libdeflate   libdeflate-gzip -V
check heif         heif-info --version
check "heif codecs" sh -c 'heif-dec --list-decoders 2>&1 | grep "^- " | tr "\n" " "'
check prlimit      prlimit --version
check bun          bun --version

exit $fail
