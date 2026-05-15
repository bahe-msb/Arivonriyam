# Demo PDFs

This folder is the committed source of truth for the live demo textbooks.

The setup script copies every PDF from this folder into `packages/ingestion/data/pdfs/` before running ingestion.

Expected structure:

```text
pdfs/
  class_1/
    Tamil.pdf
  class_2/
    EVS.pdf
  class_3/
    Social.pdf
  class_4/
    Maths.pdf
  class_5/
    Telugu.pdf
```

To add more books, follow the same pattern:

```text
pdfs/class_<N>/<Subject>.pdf
```

Examples:

- `pdfs/class_3/Science.pdf`
- `pdfs/class_5/English.pdf`
