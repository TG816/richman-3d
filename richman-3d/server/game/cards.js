/**
 * 机会 / 命运 卡牌库。
 * effect.type:
 *   money        直接收付（amount 正收负付）
 *   goto         前进到某格（沿棋盘正向走，过起点发工资）
 *   move         相对移动（正前进负后退，后退过起点不发工资）
 *   nearest      前进到最近的车站/水电公司
 *   jail         直接入狱
 *   getout       获得出狱许可证
 *   repairs      按房屋/酒店收维修费
 *   collectEach  向每位对手收取
 */

export const CHANCE = [
  { title: '拓展业务', text: '前进到「外滩」。', effect: { type: 'goto', tile: 39 } },
  { title: '回家', text: '前进到「起点」，领取工资。', effect: { type: 'goto', tile: 0 } },
  { title: '商业考察', text: '前进到「南京东路」。', effect: { type: 'goto', tile: 37 } },
  { title: '赶飞机', text: '前进到最近的机场/车站。', effect: { type: 'nearest', kind: 'station' } },
  { title: '银行红利', text: '银行发放红利，收取 ¥500。', effect: { type: 'money', amount: 500 } },
  { title: '走错路了', text: '后退三格。', effect: { type: 'move', delta: -3 } },
  { title: '酒驾被抓', text: '立即入狱，不得领取经过起点的工资。', effect: { type: 'jail' } },
  { title: '出狱许可证', text: '收好这张卡，下次入狱时可用（也可留存）。', effect: { type: 'getout' } },
  { title: '街道整修', text: '每栋房屋支付 ¥250，每座酒店支付 ¥1000。', effect: { type: 'repairs', house: 250, hotel: 1000 } },
  { title: '超速罚单', text: '缴纳罚款 ¥150。', effect: { type: 'money', amount: -150 } },
  { title: '查水表', text: '前进到最近的水电公司。', effect: { type: 'nearest', kind: 'utility' } },
  { title: '受邀剪彩', text: '前进到「王府井大街」。', effect: { type: 'goto', tile: 31 } },
];

export const FATE = [
  { title: '继承遗产', text: '收到远房亲戚的遗产 ¥1000。', effect: { type: 'money', amount: 1000 } },
  { title: '投资分红', text: '基金分红到账 ¥250。', effect: { type: 'money', amount: 250 } },
  { title: '住院看病', text: '支付医药费 ¥500。', effect: { type: 'money', amount: -500 } },
  { title: '股票上涨', text: '割了一波肉……哦不，是赚了 ¥450。', effect: { type: 'money', amount: 450 } },
  { title: '行为不端', text: '立即入狱，不得领取经过起点的工资。', effect: { type: 'jail' } },
  { title: '出狱许可证', text: '收好这张卡，下次入狱时可用（也可留存）。', effect: { type: 'getout' } },
  { title: '生日快乐', text: '今天你生日！每位玩家送你 ¥100。', effect: { type: 'collectEach', amount: 100 } },
  { title: '退税到账', text: '税务局退税 ¥200。', effect: { type: 'money', amount: 200 } },
  { title: '缴纳学费', text: '支付学费 ¥500。', effect: { type: 'money', amount: -500 } },
  { title: '市政工程', text: '每栋房屋支付 ¥400，每座酒店支付 ¥1150。', effect: { type: 'repairs', house: 400, hotel: 1150 } },
  { title: '抽奖中签', text: '幸运抽奖二等奖，奖金 ¥100。', effect: { type: 'money', amount: 100 } },
  { title: '保险到期', text: '人寿保险到期，领取 ¥1000。', effect: { type: 'money', amount: 1000 } },
];
