# face-api.js model files

Place the required face-api.js model files in this folder.

Required for current frontend flow:
- `ssd_mobilenetv1_model-weights_manifest.json`
- `ssd_mobilenetv1_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`
- `face_recognition_model-weights_manifest.json`
- `face_recognition_model-shard1`
- `face_expression_model-weights_manifest.json`
- `face_expression_model-shard1`

Default runtime URL is `/models`.
You can override with env var `VITE_FACE_API_MODEL_URL`.
