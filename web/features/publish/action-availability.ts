// 操作区按钮可用性：下载只依赖本地画布；存草稿/发布还需要登录且没有在途提交。
export interface ActionInputs {
  ready: boolean; // 已有原图
  submitting: boolean; // 有提交在途（导出查重 / 发布 / 存草稿）
  signedIn: boolean; // 已确认登录的用户（只有 token、还没确认用户时不算）
}

export function actionAvailability(s: ActionInputs): { download: boolean; submit: boolean } {
  return { download: s.ready, submit: s.ready && s.signedIn && !s.submitting };
}
