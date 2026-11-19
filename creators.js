// The creators' own support links (owner 2026-11-18). The front page puts a small cup after a credited name that has a
// link (app.js renderCatalog, design A), and the manual's "Support the creators" chapter lists them (tools/manual/build.py
// reads the JSON between the two marker lines, so keep it strict JSON). Only links a creator publishes themselves: their
// profile, a README, FUNDING.yml or their own site, never a guessed handle. Evidence: run/creator-support-2026-11-18.
// Keys are names exactly as the cards' `by` credits them; `made` is what of theirs hundekraft ships (manual only);
// `alias` marks another name for the same person (a cup on the card, no second row in the manual).
export const SUPPORT =
// SUPPORT-JSON-BEGIN
{
 "pcppcp": {
  "made": "op1r, the firmware kennel is built from; blot, ENTE, dddd, Steve, Grids and much more",
  "links": [
   {
    "label": "Ko-fi",
    "url": "https://ko-fi.com/pcppcp"
   }
  ]
 },
 "op1r": {
  "alias": "pcppcp",
  "links": [
   {
    "label": "Ko-fi",
    "url": "https://ko-fi.com/pcppcp"
   }
  ]
 },
 "LizardMan": {
  "made": "dimension, dx, sim, matrix, chorus, bitcrush, plate (Opus) and outatime",
  "links": [
   {
    "label": "Ko-fi",
    "url": "https://ko-fi.com/lizardman245"
   }
  ]
 },
 "LizardMan245": {
  "alias": "LizardMan",
  "links": [
   {
    "label": "Ko-fi",
    "url": "https://ko-fi.com/lizardman245"
   }
  ]
 },
 "displayname808": {
  "made": "the Granular features",
  "links": [
   {
    "label": "Ko-fi",
    "url": "https://ko-fi.com/displayname808"
   }
  ]
 },
 "SquareWave Studio": {
  "made": "Gin",
  "links": [
   {
    "label": "tip jar",
    "url": "https://buy.squarewave.studio/checkout/buy/59446300-c1a9-43d5-90ce-6b4c9f4252c7"
   }
  ]
 },
 "nvmsocool": {
  "made": "Windwood and Brassophone",
  "links": [
   {
    "label": "Buy Me a Coffee",
    "url": "https://buymeacoffee.com/nvmsocool"
   }
  ]
 }
}
// SUPPORT-JSON-END
;
