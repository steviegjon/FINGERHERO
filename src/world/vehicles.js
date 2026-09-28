// Vehicle silhouettes as standable profiles. x is local (0 = rear, the edge that reaches the fingers
// first, since we overtake them), h = height above the road. Parts are separate surfaces sharing k.
export const ROAD_Y = 604;

export const VEHICLES = {
  sedan: {
    parts: [{ name: 'body', w: 250, profile: [[0, 50], [16, 56], [54, 59], [86, 92], [160, 95], [198, 62], [236, 57], [250, 50]] }],
    wheels: [46, 200], wheelR: 21, bodyH: 60,
  },
  hatch: {
    parts: [{ name: 'body', w: 215, profile: [[0, 60], [10, 90], [128, 94], [166, 61], [206, 56], [215, 50]] }],
    wheels: [40, 170], wheelR: 20, bodyH: 60,
  },
  van: {
    parts: [{ name: 'body', w: 265, profile: [[0, 108], [4, 114], [182, 116], [214, 76], [256, 66], [265, 58]] }],
    wheels: [50, 214], wheelR: 22, bodyH: 70,
  },
  tractor: {
    parts: [{ name: 'body', w: 176, profile: [[0, 70], [22, 72], [30, 118], [98, 118], [104, 74], [168, 70], [176, 62]] }],
    wheels: [46, 146], wheelR: 34, wheelR2: 20, bodyH: 50,
  },
  truck: {
    parts: [
      { name: 'trailer', w: 560, profile: [[0, 168], [560, 168]], material: 'metal' },
      { name: 'cab', x: 578, w: 124, profile: [[0, 128], [74, 130], [94, 102], [124, 92]], material: 'metal' },
    ],
    wheels: [40, 86, 470, 520, 600, 676], wheelR: 20, bodyH: 0,
  },
};
