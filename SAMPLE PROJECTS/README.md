# Sample projects (not in the repository)

This folder holds the customer's reference publications: the S1000D and JSS sample packages and the reference PDFs the
output is measured against. They are about 580 MB, belong to the customer, and are therefore **not committed** (see
`.gitignore`).

Tests that read them skip themselves with the message "... is not present" when the folder is empty, so a fresh checkout
runs the rest of the suite normally. To run them, copy the sample set into this folder with its original layout:

    SAMPLE PROJECTS/
      S1000D/
        PMC-RDR-1671Y-00039-00_001-01.xml (2)/      the Xignal master publication and its data modules
        RDR-1671Y-00039-00 (9).pdf                  its reference PDF
        20_Nov _2026/                               the 20 Nov user handbook and maintenance manual packages
      JSS-0251/
        PMC-RDR-1671Y-00061-00_000-01.xml           the JSS-0251 publication (a folder, despite the name)
        RDR-1671Y-00061-00.pdf

A different location can be used for the golden-page test with `GOLDEN_SAMPLE_DIR`.
