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
check opj_compress sh -c 'opj_compress -h 2>&1 | grep -i "openjp2 v"'
check cjxl         cjxl --version
check ssimulacra2  sh -c 'ssimulacra2 2>&1 | head -n 1; test -x "$(command -v ssimulacra2)"'
check butteraugli  sh -c 'butteraugli 2>&1 | head -n 1; test -x "$(command -v butteraugli)"'
check zopfli       sh -c 'zopfli -h 2>&1 | head -n 1; dpkg-query -W -f="(deb \${Version})" zopfli'
check libdeflate   libdeflate-gzip -V
check heif         heif-info --version
check "heif codecs" sh -c 'heif-info --list-decoders 2>&1 | tr "\n" " "'
check prlimit      prlimit --version
check bun          bun --version

exit $fail
