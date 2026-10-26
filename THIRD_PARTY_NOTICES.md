# Third-party notices

## Infographic base maps

The base maps in `apps/web/src/directives/infographics/maps/` are derived from [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas), which republishes the county and township boundary open data of the Ministry of the Interior (內政部), Taiwan, under the [Open Government Data License, version 1.0](https://data.gov.tw/license).

taiwan-atlas is distributed under the MIT License:

```text
MIT License

Copyright (c) 2020 Daniel Kao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## PDF page viewer (pdf.js)

The page viewer of PDF annotations loads [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist` 6.4.299, legacy build) and its worker, copyright Mozilla Foundation, under the [Apache License, version 2.0](https://www.apache.org/licenses/LICENSE-2.0). pdf.js is loaded only when a note shows a PDF figure.

The build copies pdf.js's data files to `pdfjs/<version>/` in the web output, each folder with the licence files its package ships; they are read only when a PDF needs them:

| Folder | Content | Licence (file in the same folder) |
| --- | --- | --- |
| `cmaps/` | Adobe character maps for CJK text | Adobe BSD-style licence (`LICENSE`) |
| `iccs/` | An ICC colour profile for CMYK images | CC0 1.0 (`LICENSE`) |
| `standard_fonts/` | Foxit fonts and Liberation fonts for the 14 standard PDF fonts | PDFium BSD-3-Clause (`LICENSE_FOXIT`); Liberation Fonts, GNU GPL v2 with the font exception (`LICENSE_LIBERATION`) |
| `wasm/` | OpenJPEG (JPEG 2000), JBIG2 and qcms (ICC colour) decoders | BSD-2-Clause (`LICENSE_OPENJPEG`, `LICENSE_PDFJS_OPENJPEG`); BSD-3-Clause (`LICENSE_JBIG2`) and Apache-2.0 (`LICENSE_PDFJS_JBIG2`); MIT (`LICENSE_QCMS`, `LICENSE_PDFJS_QCMS`) |

The scripting engine (`quickjs-eval.*`) is not copied, because the viewer never runs a PDF's scripts.
