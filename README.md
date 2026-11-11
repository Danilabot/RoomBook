# RoomBook

Бронирование переговорных с расписанием по Москве, личной историей, уведомлениями и управлением комнатами. Приложение работает через браузер и использует Keycloak для входа.

## Локальный запуск

Нужны запущенный Docker с Compose v2 и `openssl`. Из корня репозитория выполните:

```sh
./scripts/init-env.sh
docker compose up -d --build --wait --wait-timeout 300
docker compose run --rm --no-deps migrate npm run seed:demo
```

Скрипт создаёт локальный `.env` с правами `0600` и случайными паролями и ключами. Сохраните его рядом с `compose.yaml` для следующих запусков. При повторном запуске скрипт сохраняет существующий файл. Команда с демоданными добавляет три комнаты и при повторном запуске сохраняет сделанные в них изменения.

- [RoomBook](http://localhost:3100) и [проверка API](http://localhost:3100/api/health).
- [Консоль Keycloak](http://localhost:8180/admin/). Для входа используйте имя `keycloak-admin` и значение `KEYCLOAK_ADMIN_PASSWORD` из локального `.env`.

| Имя пользователя | Пароль в `.env` | Возможности |
| --- | --- | --- |
| `employee` | `DEMO_EMPLOYEE_PASSWORD` | Каталог, расписание, свои бронирования и уведомления |
| `admin` | `DEMO_ADMIN_PASSWORD` | Возможности сотрудника, управление комнатами, обслуживание и отмена чужих бронирований с причиной |

Используйте в браузере имя хоста `localhost`, оно входит в зарегистрированные URL возврата. При выходе Keycloak может попросить подтвердить завершение SSO-сессии.

`docker compose down` останавливает стенд и сохраняет именованные тома PostgreSQL. Для повторного запуска выполните `docker compose up -d --wait`. Миграции выполняются до старта API и обработчика напоминаний. Keycloak импортирует realm только при его отсутствии, поэтому настройки, пользователи и изменения в консоли сохраняются. Для диагностики используйте `docker compose ps -a` и `docker compose logs migrate api reminders keycloak web`.

Напоминания появляются во входящих за 30 минут до начала бронирования. Обработчик проверяет очередь каждые 15 секунд и при ошибке повторяет доставку в следующем цикле.

## Проверка

Для backend и фронтенда нужны Node.js 24 и npm. Тесты backend используют отдельную БД, создают временные схемы и проверяют миграции, конкурирующие бронирования, авторизацию и очередь напоминаний.

```sh
docker run --rm -d --name roombook-test-db -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=roombook_test_only postgres:18
docker exec roombook-test-db pg_isready -h 127.0.0.1 -U postgres
# При ответе «no response» повторите pg_isready, пока БД не будет готова.
test_port=$(docker port roombook-test-db 5432/tcp | cut -d: -f2)
npm ci
TEST_DATABASE_URL="postgresql://postgres:roombook_test_only@127.0.0.1:${test_port}/postgres" npm test
docker stop roombook-test-db
npm ci --prefix web
npm run web:test
npm run web:build
```

Для проверки Compose войдите сотрудником, откройте расписание любой демокомнаты, создайте бронь на будущий рабочий интервал (08:00–20:00 МСК), измените название в «Мои бронирования» и отмените её. Проверьте события во входящих и запись в истории. В той же сессии `GET /api/admin/bookings` вернёт `403`. После выхода `GET /api/auth/me` вернёт `401`. Войдите как `admin`, откройте «Управление» и создайте комнату. После `docker compose down` и нового запуска проверьте комнату и отменённую бронь в соответствующих аккаунтах.

## Вход через Google

Google подключается по желанию в realm `roombook`. Для демостенда достаточно встроенных пользователей Keycloak. Для Google нужны собственные OAuth-учётные данные.

1. В консоли Keycloak выберите realm `roombook` → **Identity providers** → **Google**.
2. В Google Cloud настройте OAuth consent screen и создайте OAuth-клиент типа **Web application**. Добавьте точный **Redirect URI**, который показывает Keycloak. Для стенда с alias `google` это `http://localhost:8180/realms/roombook/broker/google/endpoint`. Если consent screen в режиме тестирования, добавьте нужный аккаунт в список тестовых пользователей.
3. Сохраните выданные Google Client ID и Client Secret в настройке провайдера в Keycloak.
4. При первом входе проверьте пользователя в Keycloak и назначьте ему через **Role mapping** клиентскую роль `employee` или `admin` клиента `roombook-api`. До назначения роли доступ к данным RoomBook закрыт.

[Инструкция Keycloak по подключению Google](https://www.keycloak.org/docs/26.5.7/server_admin/index.html#_google)

## Границы локальной конфигурации

Compose публикует на loopback только веб-интерфейс и Keycloak. Базы данных и NestJS доступны внутри сети Compose. Nginx передаёт `/api/` в NestJS через тот же браузерный origin. Сессия хранится на сервере, а браузер получает непрозрачную HttpOnly cookie. Изменяющие запросы проверяют точный `Origin` и CSRF-токен. Callback URL исключены из access-логов.

Для внешнего развёртывания настройте HTTPS для RoomBook и Keycloak, отключите `OIDC_ALLOW_LOCAL_HTTP` и замените `start-dev` на production-конфигурацию Keycloak. Согласуйте `APP_ORIGIN`, `OIDC_ISSUER`, `KC_HOSTNAME` и точные login/logout callback в клиенте `roombook-web`. При отдельном внутреннем HTTPS-адресе Keycloak укажите `OIDC_INTERNAL_ORIGIN`. Используйте отдельные эксплуатационные секреты и учётные записи. Сохраняйте тома обеих баз и отдельно защищайте `SESSION_ENCRYPTION_KEY`.
