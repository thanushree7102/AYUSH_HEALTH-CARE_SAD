# OCR / prescription reader notes

## What changed
- The offline Tesseract reader now uses a page-segmentation mode suited to prescription-style text blocks.
- Field mapping recognises a `Reported Symptoms` section as the patient's problem, rather than incorrectly filling it as the diagnosis.
- A labelled `Remedy` section can populate the medicine name and the instruction/advice separately.
- Prakriti / Vikriti and other AYUSH findings are populated only when their own labels are present. The reader no longer guesses Prakriti from stray OCR words.
- Unknown AYUSH system detection stays blank in the review form; the patient must select the correct system before saving.
- OCR timeout timers are cleared after completion so a completed read does not later terminate a reused worker.
- A regression test covers the supplied printed-English Ayurvedic prescription layout.

## Limitations
- Offline OCR uses the bundled English Tesseract model. It is not a reliable handwriting or Hindi/Devanagari recogniser.
- `ANTHROPIC_API_KEY` is optional and enables the configured vision reader. Keep the key private in `.env`; never commit it.
- OCR output is always a draft. Patients must verify it, and clinical decisions / treatment must be reviewed by an authorised practitioner.
- Do not use OCR text as an automatic diagnosis or treatment recommendation.
- The reader preserves uncertain or missing fields as blank rather than inventing clinical facts.

## Verify
Run from the project root:

```powershell
npm run test:reader
npm run check
npm run build
npm test
npm run test:isolation
```
