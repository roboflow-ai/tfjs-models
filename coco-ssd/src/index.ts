/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tfconv from '@tensorflow/tfjs-converter';
import * as tf from '@tensorflow/tfjs-core';

import {CLASSES} from './classes';

const BASE_PATH = 'https://storage.googleapis.com/tfjs-models/savedmodel/';

export {version} from './version';

export type ObjectDetectionBaseModel =
    'mobilenet_v1'|'mobilenet_v2'|'lite_mobilenet_v2';

export interface DetectedObject {
  bbox: [number, number, number, number];  // [x, y, width, height]
  class: string;
  score: number;
}

/**
 * Coco-ssd model loading is configurable using the following config dictionary.
 *
 * `base`: ObjectDetectionBaseModel. It determines wich PoseNet architecture
 * to load. The supported architectures are: 'mobilenet_v1', 'mobilenet_v2' and
 * 'lite_mobilenet_v2'. It is default to 'lite_mobilenet_v2'.
 *
 * `modelUrl`: An optional string that specifies custom url of the model. This
 * is useful for area/countries that don't have access to the model hosted on
 * GCP.
 */
export interface ModelConfig {
  base?: ObjectDetectionBaseModel;
  modelUrl?: string;
  inputSize?: number;
}

export async function load(config: ModelConfig = {}) {
  if (tf == null) {
    throw new Error(
        `Cannot find TensorFlow.js. If you are using a <script> tag, please ` +
        `also include @tensorflow/tfjs on the page before using this model.`);
  }
  const base = config.base || 'lite_mobilenet_v2';
  const modelUrl = config.modelUrl;
  const inputSize = config.inputSize;
  // if (['mobilenet_v1', 'mobilenet_v2', 'lite_mobilenet_v2'].indexOf(base) ===
  //     -1) {
  //   throw new Error(
  //       `ObjectDetection constructed with invalid base model ` +
  //       `${base}. Valid names are 'mobilenet_v1',` +
  //       ` 'mobilenet_v2' and 'lite_mobilenet_v2'.`);
  // }

  const objectDetection = new ObjectDetection(base, modelUrl);
  await objectDetection.load(base, inputSize);
  return objectDetection;
}

export class ObjectDetection {
  private modelPath: string;
  private model: tfconv.GraphModel;


  //private zeros:tf.Tensor3D = tf.zeros([640, 640, 3], 'float32');
  //private zeros:tf.Tensor3D = tf.randomUniform([320, 320, 3], 0, 255, 'float32');

  constructor(base: ObjectDetectionBaseModel, modelUrl?: string) {
    this.modelPath =
        modelUrl || `${BASE_PATH}${this.getPrefix(base)}/model.json`;
  }

  private getPrefix(base: ObjectDetectionBaseModel) {
    return base === 'lite_mobilenet_v2' ? `ssd${base}` : `ssd_${base}`;
  }

  async load(base:any, inputSize:any) {
    this.model = await tfconv.loadGraphModel(this.modelPath);

    console.log('Starting Zero Tensor');

    const zeroTensor = (base === 'yolov5s') ? tf.zeros([1, inputSize, inputSize, 3], 'float32') : tf.zeros([1, 300, 300, 3], 'int32');

    // Warmup the model.
    const result = await this.model.executeAsync(zeroTensor) as tf.Tensor[];
    await Promise.all(result.map(t => t.data()));
    result.map(t => t.dispose());
    zeroTensor.dispose();
  }

  /**
   * Infers through the model.
   *
   * @param img The image to classify. Can be a tensor or a DOM element image,
   * video, or canvas.
   * @param maxNumBoxes The maximum number of bounding boxes of detected
   * objects. There can be multiple objects of the same class, but at different
   * locations. Defaults to 20.
   * @param minScore The minimum score of the returned bounding boxes
   * of detected objects. Value between 0 and 1. Defaults to 0.5.
   * @param nmsThresh Threshold for filtering overlapping boxes
   * @param inputSize Threshold for filtering overlapping boxes

   */
  private async infer(
      base:any,
      img: tf.Tensor3D|ImageData|HTMLImageElement|HTMLCanvasElement|
      HTMLVideoElement,
      maxNumBoxes: number,
      nmsThresh: number,
      minScore: number,
      inputSize: number): Promise<DetectedObject[]> {



    if (base === 'yolov5s') {

        const batched = tf.tidy(() => {
          if (!(img instanceof tf.Tensor)) {
            //yolov5 preproc image to resize, scale to [0,1]
            // we do not need to switch channels (HWC -> CHW) .transpose([2, 0, 1])
            //const yolov5_img = tf.div(tf.browser.fromPixels(img).resizeNearestNeighbor([320, 320]).asType('float32'), 255); //img is now 480x640
            var yolov5_img = tf.browser.fromPixels(img);
            yolov5_img = tf.div(yolov5_img.resizeNearestNeighbor([inputSize, inputSize]).asType('float32'), 255);

          }

          return yolov5_img.expandDims(0);
        });

        // var t0 = performance.now();

        const result = await this.model.executeAsync(batched) as tf.Tensor[];
        //const result = this.model.execute(batched) as tf.Tensor[];

        // var t1 = performance.now();
        // console.log("Call to INFER took " + (t1 - t0) + " milliseconds.");

        //yolov5 tensor
        //console.log('yolov5 output tensor shape', result[3].shape);
        //[1,10647,5+num_classes] 5+num_classes is x, y, width, height, confidence, class_conf...

        //console.log('result ', result ) //signs result shapes 0: [1, 3, 100, 31]  1: [1, 6300, 31] 2: [1,3, 1600, 31] 3: [1,3,400,31]
        //different ordering for the cells results array...

        const chosen_result_tensor = 1;

        //console.log('result shape ', result[chosen_result_tensor].shape);

        // var t0 = performance.now();

        const yolov5_result = result[chosen_result_tensor].dataSync() as Float32Array;
        // var t1 = performance.now();
        // console.log("yolov5 float array dump took  " + (t1 - t0) + " milliseconds");
        // var t0 = performance.now();

        const num_objects = result[chosen_result_tensor].shape[1];
        const num_classes = result[chosen_result_tensor].shape[2]-5;
        //console.log('num objects ', num_objects);


        const yolov5classes =
                this.calculateMaxScoresYolov5(yolov5_result, num_objects, num_classes);

        // var t1 = performance.now();
        // console.log("max scores took  " + (t1 - t0) + " milliseconds");

        // var t0 = performance.now();

        const yolov5_confidence = this.getConfidenceYoloV5(yolov5_result, num_objects, num_classes)
        // var t1 = performance.now();
        // console.log("tidy confidence took  " + (t1 - t0) + " milliseconds");

        //yolo confidence is seperately output - mobilenet must bake into class confidence prediction

        // var t0 = performance.now();

        const yolov5_box_corners = this.getBoxesYoloV5(yolov5_result, num_objects, num_classes, inputSize);

        // var t1 = performance.now();
        // console.log("tidy box corners took  " + (t1 - t0) + " milliseconds");

        //console.log('yolov5_box_corners ', yolov5_box_corners);



        // var t0 = performance.now();

        // clean the webgl tensors
        batched.dispose();
        tf.dispose(result);
        //
        // var t1 = performance.now();
        // console.log("dispose tensors  " + (t1 - t0) + " milliseconds");

        // var t0 = performance.now();

        const prevBackend = tf.getBackend();
        // run post process in cpu
        tf.setBackend('cpu');

        const yolov5_indexTensor = tf.tidy(() => {

          // output tensor shape scores boxes, (4) [1, 1917, 1, 4] (x1,y1,x2,y2) normalized

          //console.log('num objects ', num_objects);

          const yolov5_boxes2 = tf.tensor2d(yolov5_box_corners, [num_objects, 4]);

          return tf.image.nonMaxSuppression(
              yolov5_boxes2, yolov5_confidence, maxNumBoxes, nmsThresh, minScore);
        });

        const yolov5_indexes = yolov5_indexTensor.dataSync() as Float32Array;
        yolov5_indexTensor.dispose();

        // var t1 = performance.now();
        // console.log("NMS TOOK " + (t1 - t0) + " milliseconds");

        //console.log(indexes);
        //indexes are an array of indices of objects to be included after nms

        // restore previous backend
        tf.setBackend(prevBackend);


        return this.buildDetectedObjects(
            640, 480, yolov5_box_corners, yolov5_confidence, yolov5_indexes, yolov5classes);

    }

    else {

        const batched = tf.tidy(() => {
          if (!(img instanceof tf.Tensor)) {
            //console.log(img.height); //this confirms the video is 640x640

            img = tf.browser.fromPixels(img); //img is now 480x640

          }

          return img.expandDims(0);
        });

        const height = batched.shape[1];
        const width = batched.shape[2];

        // model returns two tensors:
        // 1. box classification score with shape of [1, 1917, 90]
        // 2. box location with shape of [1, 1917, 1, 4]
        // where 1917 is the number of box detectors, 90 is the number of classes.
        // and 4 is the four coordinates of the box.

        var t0 = performance.now();

        const result = await this.model.executeAsync(batched) as tf.Tensor[];

        //const result = await this.model.executeAsync(batched) as tf.Tensor[];
        var t1 = performance.now();
        console.log("Call to INFER took " + (t1 - t0) + " milliseconds.");

        // console.log('inference shape: ', result.shape)
        // console.log('mobilenet output tensor shape scores', result[0].shape);
        // console.log('mobilenet output tensor shape scores boxes,' result[1].shape);
        // output tensor shape scores (3) [1, 1917, 90]
        // output tensor shape scores boxes, (4) [1, 1917, 1, 4]

        const scores = result[0].dataSync() as Float32Array;
        const boxes = result[1].dataSync() as Float32Array;
        // clean the webgl tensors
        batched.dispose();
        tf.dispose(result);

        const [maxScores, classes] =
            this.calculateMaxScores(scores, result[0].shape[1], result[0].shape[2]);


        const prevBackend = tf.getBackend();
        // run post process in cpu
        tf.setBackend('cpu');

        const indexTensor = tf.tidy(() => {
          const boxes2 = tf.tensor2d(boxes, [result[1].shape[1], result[1].shape[3]]);
          //console.log('boxes2 ', boxes2.dataSync() as Float32Array);
          //boxes2 entries look like [0.0015282053500413895, 0.0011117402464151382, 0.04202847182750702, 0.061883047223091125, -0.07541173696517944, -0.07601074129343033
          //console.log('boxes2 shape', boxes2); (num objects, 4 box locations)
          //2d tesnsor of shape [num_objects, 4], 4 being the box locations (x1,y1,x2,y2) and normalized 0,1

          return tf.image.nonMaxSuppression(
              boxes2, maxScores, maxNumBoxes, nmsThresh, minScore);
        });

        //console.log('indexTensor', indexTensor.dataSync() as Float32Array);
        //index tensor is a tensor with the indices of the objects to keep in the list (in the case of COCO 1)

        const indexes = indexTensor.dataSync() as Float32Array;
        indexTensor.dispose();

        //console.log(indexes);
        //indexes are an array of indices of objects to be included after nms

        // restore previous backend
        tf.setBackend(prevBackend);

        return this.buildDetectedObjects(
            width, height, boxes, maxScores, indexes, classes);

    }
  }

  private buildDetectedObjects(
      width: number, height: number, boxes: Float32Array, scores: number[],
      indexes: Float32Array, classes: number[]): DetectedObject[] {

    const count = indexes.length;
    const objects: DetectedObject[] = [];
    for (let i = 0; i < count; i++) {
      const bbox = [];
      for (let j = 0; j < 4; j++) {
        bbox[j] = boxes[indexes[i] * 4 + j];
      }
      const minY = bbox[0] * height;
      const minX = bbox[1] * width;
      const maxY = bbox[2] * height;
      const maxX = bbox[3] * width;
      bbox[0] = minX;
      bbox[1] = minY;
      bbox[2] = maxX - minX;
      bbox[3] = maxY - minY;

      objects.push({
        bbox: bbox as [number, number, number, number],
        class: CLASSES[classes[indexes[i]] + 1].displayName,
        score: scores[indexes[i]]
      });
    }
    //console.log('objects ', objects );
    return objects;
  }

  private calculateMaxScores(
      scores: Float32Array, numBoxes: number,
      numClasses: number): [number[], number[]] {
    const maxes = [];
    const classes = [];
    for (let i = 0; i < numBoxes; i++) {
      let max = Number.MIN_VALUE;
      let index = -1;
      for (let j = 0; j < numClasses; j++) {
        if (scores[i * numClasses + j] > max) {
          max = scores[i * numClasses + j];
          index = j;
        }
      }
      maxes[i] = max;
      classes[i] = index;
    }
    return [maxes, classes];
  }

  private calculateMaxScoresYolov5(
      scores: Float32Array, numBoxes: number,
      numClasses: number): number[] {
    //to avoid creating and expensive tensor slice
    //we dump the whole result float array in and ignore the first 5 entries (4 box coords and confidence)
    const maxes = [];
    const classes = [];
    for (let i = 0; i < numBoxes; i++) {
      let max = Number.MIN_VALUE;
      let index = -1;
      for (let j = 0; j < numClasses; j++) {
        if (scores[i * numClasses + (i + 1) * 5 + j] > max) {
          max = scores[i * numClasses + (i + 1) * 5 + j];
          index = j;
        }
      }
      maxes[i] = max;
      classes[i] = index;
    }
    return classes;
  }

  private getConfidenceYoloV5(
      scores: Float32Array, numBoxes: number,
      numClasses: number): number[] {
    //grab the 5th value for each object as the confidence
    const confidences = [];
    for (let i = 0; i < numBoxes; i++) {
      confidences[i] = scores[i * (numClasses + 5) + 4];
    }
    return confidences;
  }


  private getBoxesYoloV5(
      scores: Float32Array, numBoxes: number,
      numClasses: number, scale_by: number): Float32Array {
    //grab the first 4 values for each object as the box definition
    const boxes = [];
    for (let i = 0; i < numBoxes; i++) {
      const x = scores[i * (numClasses + 5) + 0];
      const y = scores[i * (numClasses + 5) + 1];
      const width = scores[i * (numClasses + 5) + 2];
      const height = scores[i * (numClasses + 5) + 3];
      //make boxes
      const x1 = (x - width / 2) / scale_by;
      const y1 = (y - height / 2) / scale_by;
      const x2 = (x + width / 2) / scale_by;
      const y2 = (y + height / 2) / scale_by;

      boxes[i * 4] = y1;
      boxes[i * 4 + 1] = x1;
      boxes[i * 4 + 2] = y2;
      boxes[i * 4 + 3] = x2;

    }
    return new Float32Array(boxes);
  }

  /**
   * Detect objects for an image returning a list of bounding boxes with
   * assocated class and score.
   *
   * @param img The image to detect objects from. Can be a tensor or a DOM
   *     element image, video, or canvas.
   * @param maxNumBoxes The maximum number of bounding boxes of detected
   * objects. There can be multiple objects of the same class, but at different
   * locations. Defaults to 20.
   * @param minScore The minimum score of the returned bounding boxes
   * of detected objects. Value between 0 and 1. Defaults to 0.5.
   */
  async detect(
      base:any,
      img: tf.Tensor3D|ImageData|HTMLImageElement|HTMLCanvasElement|
      HTMLVideoElement,
      maxNumBoxes = 20,
      nmsThresh = 0.5,
      minScore = 0.5,
      inputSize = 640): Promise<DetectedObject[]> {
    return this.infer(base, img, maxNumBoxes, nmsThresh, minScore, inputSize);
  }

  /**
   * Dispose the tensors allocated by the model. You should call this when you
   * are done with the model.
   */
  dispose() {
    if (this.model != null) {
      this.model.dispose();
    }
  }
}
