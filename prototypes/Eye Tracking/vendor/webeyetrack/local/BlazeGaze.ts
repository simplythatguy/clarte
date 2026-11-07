import * as tf from '@tensorflow/tfjs';

// References
// https://js.tensorflow.org/api/latest/#class:LayersModel

export default class BlazeGaze {
    // private model: tf.GraphModel | null = null;
    private model: tf.LayersModel | null = null;  // Use LayersModel for tf.loadLayersModel

    constructor() {
        // Optionally trigger model load in constructor
    }

    async loadModel(baseUrl: string = self.location.origin): Promise<void> {
        const path = `${baseUrl.replace(/\/$/, '')}/web/model.json`;
        try {
            // Load model from local directory (adjust path if needed)
            this.model = await tf.loadLayersModel(path);
            
        } catch (error) {
            console.error('❌ Error loading BlazeGaze model from path:', path);
            console.error(error);
            throw error;
        }
        
        // Freeze the ``cnn_model`` layers but keep the gaze_MLP trainable
        this.model.getLayer('cnn_encoder').trainable = false;
    }

    dispose(): void { this.model?.dispose(); this.model = null; }

    trainableVariables(): tf.Variable[] {
        if (!this.model) throw new Error('Model is not loaded');
        return this.model.trainableWeights.map(weight => {
            const tensor = weight.read();
            if (!(tensor instanceof tf.Variable)) throw new Error('Expected a trainable TFJS variable');
            return tensor;
        });
    }

    exportEstimator(): number[][] {
        return this.trainableVariables().map(weight => Array.from(weight.dataSync()));
    }

    restoreEstimator(weights: number[][]): void {
        const variables = this.trainableVariables();
        if (weights.length !== variables.length || weights.some((values, i) => values.length !== variables[i].size || !values.every(Number.isFinite))) throw new Error('Invalid estimator weights');
        tf.tidy(() => variables.forEach((variable, i) => variable.assign(tf.tensor(weights[i], variable.shape))));
    }

    predict(image: tf.Tensor, head_vector: tf.Tensor, face_origin_3d: tf.Tensor): tf.Tensor {
        if (!this.model) {
            throw new Error('Model not loaded. Call loadModel() first.');
        }

        const inputList: tf.Tensor[] = [image, head_vector, face_origin_3d];

        // Run inference
        const output = this.model.predict(inputList) as tf.Tensor | tf.Tensor[];  // GraphModel always returns Tensor or Tensor[]

        if (Array.isArray(output)) {
            return output[0];  // Return the first tensor if multiple
        }

        return output;
    }
}
