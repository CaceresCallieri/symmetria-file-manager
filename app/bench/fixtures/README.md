# Synthetic PDF compatibility fixtures

These fixtures contain generated content. They contain no user documents or real passwords.

- `jpeg2000/red.pdf` contains one 64 × 64 solid red RGB image, encoded with OpenJPEG 2.5.4 and embedded with `/JPXDecode`. The PDF draws that image across a 100 × 100 page. The benchmark requires an exact center pixel of `[255, 0, 0, 255]`; a visible blank canvas does not pass.
- `password/locked.pdf` encrypts the same document with AES-256 through qpdf 12.3.2. The synthetic user password is `pdf-test-password`. The synthetic owner password is `pdf-test-owner`.

To regenerate the encrypted fixture from the image fixture:

```bash
qpdf --encrypt pdf-test-password pdf-test-owner 256 -- \
  app/bench/fixtures/jpeg2000/red.pdf app/bench/fixtures/password/locked.pdf
```

The benchmark consumes the checked-in files. It does not require qpdf or OpenJPEG at runtime.
