// Tạo @drawable/notification_icon và @color/notification_icon_color cho Android
// (plugin @react-native-firebase/messaging tham chiếu 2 resource này để hiển thị icon/màu thông báo).
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withAndroidColors, AndroidConfig } = require('expo/config-plugins');

module.exports = function withNotificationIcon(config, { icon, color }) {
  config = withAndroidColors(config, (c) => {
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: 'notification_icon_color', value: color });
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.resolve(c.modRequest.projectRoot, icon), path.join(dir, 'notification_icon.png'));
      return c;
    },
  ]);
};
