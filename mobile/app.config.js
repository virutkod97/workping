// Cho phép EAS Build nạp file Firebase từ "file environment variables" (không commit file bí mật).
// Local: dùng mặc định trong app.json (thư mục ./firebase).
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? config.ios.googleServicesFile },
  android: { ...config.android, googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile },
});
