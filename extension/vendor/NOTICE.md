# Included dependencies

- Supertonic web helper, from https://github.com/supertone-oss-archive/supertonic, MIT license in SUPERTONIC-LICENSE. Locally modified to import the bundled ONNX runtime and bound unpunctuated text chunks.
- ONNX Runtime Web 1.22.0, https://www.npmjs.com/package/onnxruntime-web/v/1.22.0. MIT license and third-party notices in ort/.
- Supertonic 3 models and voice profiles downloaded from https://huggingface.co/supertone-oss-archive/supertonic-3 at revision aafc6e32416a594460b32413efc49d7fe4ce6d46. Model license in MODEL-LICENSE (OpenRAIL). Model use is subject to that license.
- File lengths and SHA-256 digests are recorded in ../model-assets.json. Model weights are downloaded on first use and are not committed in this repository.
