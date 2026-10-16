// Derived from uncommented .clip elements in /home/lufering/video-cut/token/film/index.html.
// This describes the *current mixed legacy render*, not the V3 target timeline.
export interface ActiveFilmClip {
  id: string
  start: number
  duration: number
  track: number
  title: string
  src: string
}

export const ACTIVE_FILM_CLIPS: ActiveFilmClip[] = [
  { id: 's01', start: 0.000, duration: 3.900, track: 0, title: 'Token 出现', src: 'compositions/s01.html' },
  { id: 's02', start: 3.900, duration: 7.900, track: 1, title: '无数科技大佬', src: 'compositions/s02.html' },
  { id: 's03', start: 11.800, duration: 7.000, track: 2, title: '词元', src: 'compositions/s03.html' },
  { id: 's04', start: 18.800, duration: 2.200, track: 3, title: '翻页转场', src: 'compositions/s04.html' },
  { id: 's05', start: 20.200, duration: 9.000, track: 4, title: '计量单位', src: 'compositions/s05.html' },
  { id: 's06', start: 29.200, duration: 7.000, track: 5, title: '人民币类比', src: 'compositions/s06.html' },
  { id: 's07', start: 36.200, duration: 5.400, track: 6, title: '没什么稀奇', src: 'compositions/s07.html' },
  { id: 's08', start: 41.600, duration: 4.000, track: 7, title: '问题来了', src: 'compositions/s08.html' },
  { id: 's09', start: 45.600, duration: 7.400, track: 8, title: '黄仁勋', src: 'compositions/s09.html' },
  { id: 's26', start: 55.960, duration: 3.210, track: 8, title: 'V3 段16 · 计量在哪？', src: 'compositions/s26.html' },
  { id: 's27', start: 59.170, duration: 2.050, track: 9, title: 'V3 段17 · 账在哪？', src: 'compositions/s27.html' },
  { id: 's28', start: 61.220, duration: 1.460, track: 10, title: 'V3 段18 · 它被藏起来了', src: 'compositions/s28.html' },
  { id: 's29', start: 62.680, duration: 5.740, track: 11, title: 'V3 段19 · 免费就不跟你算账', src: 'compositions/s29.html' },
  { id: 's30', start: 68.420, duration: 2.050, track: 12, title: '彩蛋 · 豆包收费', src: 'compositions/s30.html' },
  { id: 's13', start: 74.400, duration: 6.400, track: 12, title: '打开手机', src: 'compositions/s13.html' },
  { id: 's14', start: 80.800, duration: 6.600, track: 13, title: '看不见 token', src: 'compositions/s14.html' },
  { id: 's15', start: 87.400, duration: 7.000, track: 14, title: '因为免费', src: 'compositions/s15.html' },
  { id: 's16', start: 94.400, duration: 8.000, track: 15, title: '两种计费', src: 'compositions/s16.html' },
  { id: 's17', start: 102.400, duration: 7.600, track: 16, title: '一头算力 一头生产力', src: 'compositions/s17.html' },
  { id: 's18', start: 110.000, duration: 8.000, track: 17, title: '循环转起来', src: 'compositions/s18.html' },
  { id: 's19', start: 118.000, duration: 6.400, track: 18, title: '薅', src: 'compositions/s19.html' },
  { id: 's20', start: 124.400, duration: 6.600, track: 19, title: '三块钱', src: 'compositions/s20.html' },
  { id: 's21', start: 131.000, duration: 7.200, track: 20, title: '那是多少', src: 'compositions/s21.html' },
  { id: 's22', start: 138.200, duration: 7.000, track: 21, title: '免费额度', src: 'compositions/s22.html' },
  { id: 's23', start: 145.200, duration: 6.800, track: 22, title: '收', src: 'compositions/s23.html' },
].sort((a, b) => a.start - b.start)
