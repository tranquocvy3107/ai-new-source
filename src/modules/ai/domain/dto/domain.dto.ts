export enum InvestmentSignal {
  ALL_IN = 'ALL_IN', // Cực thơm, KD thấp, Profit cao
  SCALING = 'SCALING', // Đang có đà, cần bơm thêm lực
  WATCHLIST = 'WATCHLIST', // Theo dõi, chưa rõ rệt
  HIGH_BARRIER = 'HIGH_BARRIER', // Khó ăn, đối thủ quá mạnh
  AVOID = 'AVOID', // Không có tiềm năng
}

export interface ClassifiledDomain {
  // --- Identification ---
  domain: string;
  homepageUrl: string;

  // --- Financial Power (Profitability) ---
  estimatedMonthlyRevenue: number; // Tính từ organicTrafficCost
  commissionPotential: {
    rate: string | null;
    type: string | null;
    avgOrderValue: number; // Ước tính từ giá sản phẩm cào được
  };

  // --- Market Dynamics (Competition) ---
  authorityScore: number; // Sức mạnh tên miền (42)
  competitionLevel: number; // 0 - 1 (Dựa trên đối thủ)
  isMarketSaturated: boolean; // Đúng nếu đối thủ có Traffic gấp 10 lần mình

  // --- Traffic Quality ---
  trafficHealth: {
    total: number;
    organicRatio: number; // Tỉ lệ traffic tự nhiên / tổng
    nonBrandedRatio: number; // Tỉ lệ cơ hội cho người mới
    trafficValue: number; // Giá trị quy đổi ra tiền ($105k)
  };

  // --- AI & Social Proof ---
  socialMentions: {
    topPlatform: string; // e.g., "Medium" hoặc "Reddit"
    totalMentions: number;
  };

  // --- The "Verdict" (Kết luận) ---
  investmentSignal: InvestmentSignal;
  recommendationReason: string; // Giải thích tại sao chọn Signal đó
}
