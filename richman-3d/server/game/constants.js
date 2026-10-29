/**
 * 棋盘定义 —— 40 格，中国城市街道主题。
 * 数值为经典大富翁比例 ×10（初始资金 15000，街价 600~4000）。
 */

export const GROUPS = {
  brown:     { name: '老城区', color: 0x9c6b4a, houseCost: 500 },
  lightblue: { name: '步行街', color: 0x86c5e8, houseCost: 500 },
  pink:      { name: '园林带', color: 0xe46fae, houseCost: 1000 },
  orange:    { name: '胡同坊', color: 0xf29a3d, houseCost: 1000 },
  red:       { name: '商业圈', color: 0xe2504a, houseCost: 1500 },
  yellow:    { name: '金融城', color: 0xf2d43d, houseCost: 1500 },
  green:     { name: '黄金段', color: 0x3fae6a, houseCost: 2000 },
  blue:      { name: '地标区', color: 0x4a6fd6, houseCost: 2000 },
};

/** 角色预设（客户端据此渲染对应配色的小机器人） */
export const AVATARS = [
  { id: 'red',    name: '阿赤', color: '#e2504a' },
  { id: 'blue',   name: '阿蓝', color: '#4a7fd6' },
  { id: 'green',  name: '阿绿', color: '#3fae6a' },
  { id: 'yellow', name: '阿黄', color: '#e8b83d' },
  { id: 'purple', name: '阿紫', color: '#9a5fd6' },
  { id: 'orange', name: '阿橙', color: '#f2853d' },
];

// rent: 无房基础租金；rents: [1栋,2栋,3栋,4栋,酒店] 阶梯租金
const P = (name, group, price, rent, rents) =>
  ({ type: 'prop', name, group, price, rent, rents });

const S = (name, price = 2000) => ({ type: 'station', name, price });
const U = (name, price = 1500) => ({ type: 'utility', name, price });

export const BOARD = [
  { type: 'go',    name: '起点' },                        // 0
  P('老城南巷', 'brown', 600, 20, [100, 300, 900, 1600, 2500]), // 1
  { type: 'fate',   name: '命运' },                        // 2
  P('稻香巷', 'brown', 600, 40, [200, 600, 1800, 3200, 4500]), // 3
  { type: 'tax',    name: '所得税', amount: 2000 },        // 4
  S('虹桥枢纽'),                                           // 5
  P('上下九步行街', 'lightblue', 1000, 60, [300, 900, 2700, 4000, 5500]), // 6
  { type: 'chance', name: '机会' },                        // 7
  P('太平老街', 'lightblue', 1000, 60, [300, 900, 2700, 4000, 5500]), // 8
  P('中山路', 'lightblue', 1200, 80, [400, 1000, 3000, 4500, 6000]),  // 9
  { type: 'jail',   name: '监狱' },                        // 10
  P('观前街', 'pink', 1400, 100, [500, 1500, 4500, 6250, 7500]),      // 11
  U('电力公司'),                                           // 12
  P('山塘街', 'pink', 1400, 100, [500, 1500, 4500, 6250, 7500]),      // 13
  P('夫子庙', 'pink', 1600, 120, [600, 1800, 5000, 7000, 9000]),      // 14
  S('白云机场'),                                           // 15
  P('江汉路', 'orange', 1800, 140, [700, 2000, 5500, 7500, 9500]),    // 16
  { type: 'fate',   name: '命运' },                        // 17
  P('鼓楼大街', 'orange', 1800, 140, [700, 2000, 5500, 7500, 9500]),  // 18
  P('南锣鼓巷', 'orange', 2000, 160, [800, 2200, 6000, 8000, 10000]), // 19
  { type: 'park',   name: '免费停车' },                    // 20
  P('淮海中路', 'red', 2200, 180, [900, 2500, 7000, 8750, 10500]),    // 21
  { type: 'chance', name: '机会' },                        // 22
  P('解放碑', 'red', 2200, 180, [900, 2500, 7000, 8750, 10500]),      // 23
  P('南京西路', 'red', 2400, 200, [1000, 3000, 7500, 9250, 11000]),   // 24
  S('深圳北站'),                                           // 25
  P('春熙路', 'yellow', 2600, 220, [1100, 3300, 8000, 9750, 11500]),  // 26
  P('滨江道', 'yellow', 2600, 220, [1100, 3300, 8000, 9750, 11500]),  // 27
  U('自来水公司'),                                         // 28
  P('和平路', 'yellow', 2800, 240, [1200, 3600, 8500, 10250, 12000]), // 29
  { type: 'gotojail', name: '入狱' },                      // 30
  P('王府井大街', 'green', 3000, 260, [1300, 3900, 9000, 11000, 12750]), // 31
  P('西单北大街', 'green', 3000, 260, [1300, 3900, 9000, 11000, 12750]), // 32
  { type: 'fate',   name: '命运' },                        // 33
  P('北京路', 'green', 3200, 280, [1500, 4500, 10000, 12000, 14000]), // 34
  S('香港西九龙站'),                                       // 35
  { type: 'chance', name: '机会' },                        // 36
  P('南京东路', 'blue', 3500, 350, [1750, 5000, 11000, 13000, 15000]), // 37
  { type: 'tax',    name: '奢侈税', amount: 1000 },        // 38
  P('外滩', 'blue', 4000, 500, [2000, 6000, 14000, 17000, 20000]),    // 39
];

/** 同组的格位索引，便于垄断判定与均匀建房 */
export const GROUP_TILES = {};
BOARD.forEach((t, i) => {
  if (t.type === 'prop') {
    (GROUP_TILES[t.group] ||= []).push(i);
  }
});
