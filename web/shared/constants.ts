// 喜茶杯贴画布规格与上传上限（与官方 App 及 Go 后端一致）。
export const CUP_WIDTH = 596;
export const CUP_HEIGHT = 832;
export const MAX_UPLOAD_BYTES = 200 * 1024;
// 喜茶底色 #EEEEEE 的灰度值。成品只能是黑色加这个底色（审核不放行其他颜色），
// 画笔、文字、橡皮擦的边缘是二者之间的抗锯齿灰阶
export const BACKGROUND_GRAY = 0xee;
export const BACKGROUND_COLOR = `rgb(${BACKGROUND_GRAY}, ${BACKGROUND_GRAY}, ${BACKGROUND_GRAY})`;
