#!/usr/bin/env bun
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { YAML } from 'bun';
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { Book } from './src/book.js';
import { schema } from './src/models/configuration.js';

const HELP = `
bookbinder <input.pdf> [output_dir] [options]

Rearranges PDF pages into printable signatures for bookbinding.
output_dir defaults to a directory named after the input file.

Options:
  --config <path>                  YAML config file (values overridden by CLI flags)

  --paper-size <size>              LETTER, A4, A5, ... (default: A4)
  --paper-rotation                 Rotate paper 90 degrees
  --rotate-page                    Flip on long side for duplex printing
  --printer-type <type>            duplex | single  (default: duplex)
  --print-file <mode>              both | signatures | aggregated  (default: both)
  --source-rotation <r>            none | 90cw | 90ccw | out_binding | in_binding  (default: none)

  --page-layout <l>                folio | quarto | octavo | sextodecimo  (default: folio)
  --page-scaling <s>               lockratio | centered | stretch  (default: lockratio)
  --page-positioning <p>           centered | binding_aligned  (default: centered)
  --fore-edge-padding <pt>         Fore-edge margin in points  (default: 0)
  --binding-edge-padding <pt>      Binding-edge margin in points  (default: 0)
  --top-edge-padding <pt>          Top margin in points  (default: 0)
  --bottom-edge-padding <pt>       Bottom margin in points  (default: 0)

  --sig-format <f>                 booklet | perfect | standardsig | customsig |
                                   1_3rd | A7_2_16s | 8_zine | a_3_6s |
                                   a9_3_3_4 | a_4_8s | a10_6_10s  (default: standardsig)
  --sig-length <n>                 Sheets per signature for standardsig  (default: 4)
  --custom-sig <list>              Comma-separated sheet counts, e.g. "4,4,6"
  --wacky-spacing <s>              wacky_pack | wacky_gap  (default: wacky_pack)
  --wacky-fore-edge-padding <pt>   Fore-edge padding for wacky layouts  (default: 0)
  --flyleafs <n>                   Blank pages added at start and end  (default: 1)

  --fold-marks                     Draw fold lines
  --cut-marks                      Draw cut lines
  --pdf-edge-marks                 Draw spine PDF-bounds indicators
  --sig-order-marks                Draw signature-order marks on spine

  --sewing-marks                   Enable sewing hole markers
  --sewing-mark-locations <l>      all | only_out | only_in | in_n_out  (default: all)
  --sewing-marks-margin <pt>       Distance from page end to kettle stitch  (default: 72)
  --sewing-marks-amount <n>        Number of sewing holes  (default: 3)
  --sewing-marks-tape-width <pt>   Distance between sewing points  (default: 36)

  --custom-width <pt>              Custom paper width in points  (requires --paper-size CUSTOM)
  --custom-height <pt>             Custom paper height in points  (requires --paper-size CUSTOM)

  -h, --help                       Show this help text
`;

// Maps YAML snake_case keys → Zod schema camelCase keys
const YAML_KEY_MAP = {
  paper_size: 'paperSize',
  paper_rotation: 'paperRotation90',
  rotate_page: 'rotatePage',
  printer_type: 'printerType',
  print_file: 'printFile',
  source_rotation: 'sourceRotation',
  page_layout: 'pageLayout',
  page_scaling: 'pageScaling',
  page_positioning: 'pagePositioning',
  fore_edge_padding: 'mainForeEdgePaddingPt',
  binding_edge_padding: 'bindingEdgePaddingPt',
  top_edge_padding: 'topEdgePaddingPt',
  bottom_edge_padding: 'bottomEdgePaddingPt',
  sig_format: 'sigFormat',
  sig_length: 'sigLength',
  custom_sig: 'customSigLength',
  wacky_spacing: 'wackySpacing',
  wacky_fore_edge_padding: 'foreEdgePaddingPt',
  flyleafs: 'flyleafs',
  fold_marks: 'cropMarks',
  cut_marks: 'cutMarks',
  pdf_edge_marks: 'pdfEdgeMarks',
  sig_order_marks: 'sigOrderMarks',
  sewing_marks: 'sewingMarksEnabled',
  sewing_mark_locations: 'sewingMarkLocation',
  sewing_marks_margin: 'sewingMarksMarginPt',
  sewing_marks_amount: 'sewingMarksAmount',
  sewing_marks_tape_width: 'sewingMarksTapeWidthPt',
  custom_width: 'paperSizeCustomWidth',
  custom_height: 'paperSizeCustomHeight',
};

function yamlToRaw(yaml) {
  const result = {};
  for (const [k, v] of Object.entries(YAML_KEY_MAP)) {
    if (k in yaml) result[v] = yaml[k];
  }
  return result;
}

function argsToRaw(values) {
  const result = {};
  const str = (k, prop) => {
    if (values[k] !== undefined) result[prop] = values[k];
  };
  const flag = (k, prop) => {
    if (values[k] !== undefined) result[prop] = values[k];
  };

  str('paper-size', 'paperSize');
  flag('paper-rotation', 'paperRotation90');
  flag('rotate-page', 'rotatePage');
  str('printer-type', 'printerType');
  str('print-file', 'printFile');
  str('source-rotation', 'sourceRotation');
  str('page-layout', 'pageLayout');
  str('page-scaling', 'pageScaling');
  str('page-positioning', 'pagePositioning');
  str('fore-edge-padding', 'mainForeEdgePaddingPt');
  str('binding-edge-padding', 'bindingEdgePaddingPt');
  str('top-edge-padding', 'topEdgePaddingPt');
  str('bottom-edge-padding', 'bottomEdgePaddingPt');
  str('sig-format', 'sigFormat');
  str('sig-length', 'sigLength');
  str('custom-sig', 'customSigLength');
  str('wacky-spacing', 'wackySpacing');
  str('wacky-fore-edge-padding', 'foreEdgePaddingPt');
  str('flyleafs', 'flyleafs');
  flag('fold-marks', 'cropMarks');
  flag('cut-marks', 'cutMarks');
  flag('pdf-edge-marks', 'pdfEdgeMarks');
  flag('sig-order-marks', 'sigOrderMarks');
  flag('sewing-marks', 'sewingMarksEnabled');
  str('sewing-mark-locations', 'sewingMarkLocation');
  str('sewing-marks-margin', 'sewingMarksMarginPt');
  str('sewing-marks-amount', 'sewingMarksAmount');
  str('sewing-marks-tape-width', 'sewingMarksTapeWidthPt');
  str('custom-width', 'paperSizeCustomWidth');
  str('custom-height', 'paperSizeCustomHeight');
  return result;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'paper-size': { type: 'string' },
      'paper-rotation': { type: 'boolean' },
      'rotate-page': { type: 'boolean' },
      'printer-type': { type: 'string' },
      'print-file': { type: 'string' },
      'source-rotation': { type: 'string' },
      'page-layout': { type: 'string' },
      'page-scaling': { type: 'string' },
      'page-positioning': { type: 'string' },
      'fore-edge-padding': { type: 'string' },
      'binding-edge-padding': { type: 'string' },
      'top-edge-padding': { type: 'string' },
      'bottom-edge-padding': { type: 'string' },
      'sig-format': { type: 'string' },
      'sig-length': { type: 'string' },
      'custom-sig': { type: 'string' },
      'wacky-spacing': { type: 'string' },
      'wacky-fore-edge-padding': { type: 'string' },
      flyleafs: { type: 'string' },
      'fold-marks': { type: 'boolean' },
      'cut-marks': { type: 'boolean' },
      'pdf-edge-marks': { type: 'boolean' },
      'sig-order-marks': { type: 'boolean' },
      'sewing-marks': { type: 'boolean' },
      'sewing-mark-locations': { type: 'string' },
      'sewing-marks-margin': { type: 'string' },
      'sewing-marks-amount': { type: 'string' },
      'sewing-marks-tape-width': { type: 'string' },
      'custom-width': { type: 'string' },
      'custom-height': { type: 'string' },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP + '\n');
    process.exit(positionals.length === 0 && !values.help ? 1 : 0);
  }

  // Load YAML config if specified
  let yamlRaw = {};
  if (values.config) {
    const text = await Bun.file(values.config).text();
    yamlRaw = yamlToRaw(YAML.parse(text));
  }

  // Merge: Zod defaults ← YAML ← CLI args, then validate with Zod
  const config = schema.parse({ ...yamlRaw, ...argsToRaw(values) });

  const inputPath = positionals[0];
  const inputBase = basename(inputPath, extname(inputPath));
  const outputDir = positionals[1] ?? join('.', inputBase);
  await mkdir(outputDir, { recursive: true });

  const book = new Book(config);
  await book.openpdf(Bun.file(inputPath));
  await book.createpages();

  // Derive output filename (same logic as the original createoutputfiles)
  const rotationMeta =
    (config.paperRotation90 ? 'paper_rotated' : '') +
    (config.sourceRotation === 'none' ? '' : `_${config.sourceRotation}`);
  book.filename =
    inputBase
      .replace(/[-\s,_]+/g, '_')
      .replace(/_*\.pdf/gi, '')
      .toLowerCase() + rotationMeta;

  const isClassic = ['booklet', 'perfect', 'standardsig', 'customsig'].includes(config.sigFormat);

  if (isClassic) {
    const signatures = [{}];
    await book.generateClassicFiles(false, signatures);
    await book.saveClassicFiles(signatures, outputDir);
  } else {
    const builderFns = {
      a9_3_3_4: () => book.book.a9_3_3_4_builder(),
      a10_6_10s: () => book.book.a10_6_10s_builder(),
      a_4_8s: () => book.book.a_4_8s_builder(),
      a_3_6s: () => book.book.a_3_6s_builder(),
      A7_2_16s: () => book.book.a7_2_16s_builder(),
      '1_3rd': () => book.book.page_1_3rd_builder(),
      '8_zine': () => book.book.page_8_zine_builder(),
    };
    const builderFn = builderFns[config.sigFormat];
    if (!builderFn) throw new Error(`Unknown sig format: ${config.sigFormat}`);
    await book.buildSheets(book.filename, builderFn(), outputDir);
  }

  console.log(`Done. Output written to: ${outputDir}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
