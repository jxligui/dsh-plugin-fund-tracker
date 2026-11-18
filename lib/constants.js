/** Shared constants for the fund tracker Host half. */

export const FUNDGZ = 'https://fundgz.1234567.com.cn/js/';
export const INDEX_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
export const SEARCH_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx';
export const FUND_LIST_URL = 'https://fund.eastmoney.com/js/fundcode_search.js';
export const PINGZHONG = 'https://fund.eastmoney.com/pingzhongdata/';

export const MAX_CODES = 60;
export const SPANS = [['w1', 7], ['m1', 30], ['m3', 90], ['m6', 180], ['y1', 365]];
export const LIB_REFRESH_MS = 24 * 3600 * 1000;

// Built-in index library: [secid, code, name, pinyin, category]
export const INDEX_LIBRARY = [
  ['1.000001', '000001', '上证指数', 'SZSZ', '大盘'],
  ['0.399001', '399001', '深证成指', 'SZCZ', '大盘'],
  ['0.399006', '399006', '创业板指', 'CYBZ', '大盘'],
  ['1.000300', '000300', '沪深300', 'HS300', '大盘'],
  ['1.000688', '000688', '科创50', 'KC50', '大盘'],
  ['1.000905', '000905', '中证500', 'ZZ500', '大盘'],
  ['1.000016', '000016', '上证50', 'SZ50', '大盘'],
  ['0.399005', '399005', '中小100', 'ZXB100', '大盘'],
  ['1.000852', '000852', '中证1000', 'ZZ1000', '规模'],
  ['0.399303', '399303', '国证2000', 'GZ2000', '规模'],
  ['1.000922', '000922', '中证红利', 'ZZHL', '红利'],
  ['1.000015', '000015', '红利指数', 'HLZS', '红利'],
  ['0.399975', '399975', '证券公司', 'ZQGS', '行业'],
  ['0.399997', '399997', '中证白酒', 'ZZBJ', '行业'],
  ['0.399986', '399986', '中证银行', 'ZZYH', '行业'],
  ['1.000933', '000933', '中证医药', 'ZZYY', '行业'],
  ['0.399989', '399989', '中证医疗', 'ZZYL', '行业'],
  ['0.399967', '399967', '中证军工', 'ZZJG', '行业'],
  ['0.399971', '399971', '中证传媒', 'ZZCM', '行业'],
  ['0.399396', '399396', '国证食品', 'GZSP', '行业'],
  ['1.000827', '000827', '中证环保', 'ZZHB', '行业'],
  ['0.399808', '399808', '中证有色', 'ZZYS', '行业'],
  ['1.000928', '000928', '中证能源', 'ZZNY', '行业'],
  ['1.000941', '000941', '中证水电', 'ZZSD', '行业'],
  ['100.HSI', 'HSI', '恒生指数', 'HSZS', '海外'],
  ['100.HSTECH', 'HSTECH', '恒生科技', 'HSKJ', '海外'],
  ['100.NDX', 'NDX', '纳斯达克100', 'NSDK100', '海外'],
  ['100.DJIA', 'DJIA', '道琼斯工业', 'DQSGY', '海外'],
  ['100.SPX', 'SPX', '标普500', 'BP500', '海外'],
];

// Default visible indices when the user has not chosen any.
export const DEFAULT_INDICE_CODES = ['000001', '399001', '399006', '000300', '000688', '000905', '000016', 'HSI'];

// Curated ETF library: [secid, code, name, theme] — realtime exchange prices.
export const ETF_LIBRARY = [
  ['1.510300', '510300', '沪深300ETF', '宽基'],
  ['1.510500', '510500', '上证50ETF', '宽基'],
  ['0.159915', '159915', '创业板ETF', '宽基'],
  ['1.588000', '588000', '科创50ETF', '宽基'],
  ['0.159949', '159949', '创业板50ETF', '宽基'],
  ['1.510880', '510880', '红利ETF', '红利'],
  ['1.512480', '512480', '半导体ETF', '科技'],
  ['0.159995', '159995', '芯片ETF', '科技'],
  ['1.515050', '515050', '5G通信ETF', '科技'],
  ['1.512690', '512690', '酒ETF', '消费'],
  ['0.159928', '159928', '消费ETF', '消费'],
  ['1.512010', '512010', '医药ETF', '医药'],
  ['0.159929', '159929', '医疗ETF', '医药'],
  ['1.515790', '515790', '光伏ETF', '新能源'],
  ['1.515030', '515030', '新能源车ETF', '新能源'],
  ['0.159875', '159875', '电池ETF', '新能源'],
  ['1.512660', '512660', '军工ETF', '军工'],
  ['1.512000', '512000', '券商ETF', '金融'],
  ['1.512800', '512800', '银行ETF', '金融'],
  ['1.512400', '512400', '有色金属ETF', '周期'],
  ['0.159611', '159611', '电力ETF', '周期'],
  ['1.513100', '513100', '纳指ETF', '海外'],
  ['1.513500', '513500', '标普ETF', '海外'],
  ['1.513180', '513180', '恒生科技ETF', '海外'],
];

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
