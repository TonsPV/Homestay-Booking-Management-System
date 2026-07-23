import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchemaBaseline1784770000000 implements MigrationInterface {
  name = 'InitialSchemaBaseline1784770000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id bigint NOT NULL AUTO_INCREMENT,
        full_name varchar(120) NOT NULL,
        email varchar(160) NOT NULL,
        phone varchar(30) DEFAULT NULL,
        password_hash varchar(255) NOT NULL,
        role enum('STAFF','ADMIN') NOT NULL DEFAULT 'STAFF',
        status enum('ACTIVE','LOCKED') NOT NULL DEFAULT 'ACTIVE',
        created_at datetime NOT NULL DEFAULT (now()),
        updated_at datetime NOT NULL DEFAULT (now()),
        deleted_at datetime DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email),
        UNIQUE KEY uq_users_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id bigint NOT NULL AUTO_INCREMENT,
        full_name varchar(120) NOT NULL,
        email varchar(160) DEFAULT NULL,
        phone varchar(30) NOT NULL,
        password_hash varchar(255) DEFAULT NULL,
        status enum('ACTIVE','LOCKED') NOT NULL DEFAULT 'ACTIVE',
        created_at datetime NOT NULL DEFAULT (now()),
        updated_at datetime NOT NULL DEFAULT (now()),
        deleted_at datetime DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_customers_phone (phone),
        UNIQUE KEY uq_customers_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS room_types (
        id bigint NOT NULL AUTO_INCREMENT,
        name varchar(120) NOT NULL,
        description text,
        max_guests int NOT NULL,
        base_price decimal(12,2) NOT NULL,
        created_at datetime NOT NULL DEFAULT (now()),
        updated_at datetime NOT NULL DEFAULT (now()),
        deleted_at datetime DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_room_types_name (name),
        CONSTRAINT chk_room_types_base_price CHECK (base_price >= 0),
        CONSTRAINT chk_room_types_max_guests CHECK (max_guests > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id bigint NOT NULL AUTO_INCREMENT,
        room_type_id bigint NOT NULL,
        room_number varchar(50) NOT NULL,
        name varchar(120) NOT NULL,
        description text,
        status enum('READY','OCCUPIED','CLEANING','MAINTENANCE','HIDDEN')
          NOT NULL DEFAULT 'READY',
        created_at datetime NOT NULL DEFAULT (now()),
        updated_at datetime NOT NULL DEFAULT (now()),
        deleted_at datetime DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rooms_room_number (room_number),
        KEY idx_rooms_room_type (room_type_id),
        KEY idx_rooms_status (status),
        CONSTRAINT rooms_ibfk_1
          FOREIGN KEY (room_type_id) REFERENCES room_types (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS room_images (
        id bigint NOT NULL AUTO_INCREMENT,
        room_id bigint NOT NULL,
        image_url varchar(500) NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        is_cover tinyint(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY idx_room_images_room (room_id),
        KEY idx_room_images_cover (room_id, is_cover),
        CONSTRAINT room_images_ibfk_1
          FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id bigint NOT NULL AUTO_INCREMENT,
        booking_code varchar(40) NOT NULL,
        customer_id bigint NOT NULL,
        room_id bigint NOT NULL,
        created_by_user_id bigint DEFAULT NULL,
        check_in_date date NOT NULL,
        check_out_date date NOT NULL,
        guest_count int NOT NULL,
        contact_name varchar(120) NOT NULL,
        contact_phone varchar(30) NOT NULL,
        contact_email varchar(160) DEFAULT NULL,
        total_amount decimal(12,2) NOT NULL DEFAULT 0.00,
        status enum(
          'PENDING_PAYMENT',
          'CONFIRMED',
          'CHECKED_IN',
          'CHECKED_OUT',
          'CANCELLED'
        ) NOT NULL DEFAULT 'PENDING_PAYMENT',
        payment_status enum('UNPAID','PAID','REFUNDED')
          NOT NULL DEFAULT 'UNPAID',
        customer_note text,
        cancelled_at datetime DEFAULT NULL,
        cancellation_reason varchar(500) DEFAULT NULL,
        created_at datetime NOT NULL DEFAULT (now()),
        updated_at datetime NOT NULL DEFAULT (now()),
        PRIMARY KEY (id),
        UNIQUE KEY uq_bookings_code (booking_code),
        KEY idx_bookings_customer (customer_id),
        KEY idx_bookings_created_by_user (created_by_user_id),
        KEY idx_bookings_room_date (room_id, check_in_date, check_out_date),
        KEY idx_bookings_status (status),
        KEY idx_bookings_payment_status (payment_status),
        CONSTRAINT bookings_ibfk_1
          FOREIGN KEY (customer_id) REFERENCES customers (id),
        CONSTRAINT bookings_ibfk_2
          FOREIGN KEY (room_id) REFERENCES rooms (id),
        CONSTRAINT bookings_ibfk_3
          FOREIGN KEY (created_by_user_id) REFERENCES users (id),
        CONSTRAINT chk_bookings_date_range
          CHECK (check_in_date < check_out_date),
        CONSTRAINT chk_bookings_guest_count CHECK (guest_count > 0),
        CONSTRAINT chk_bookings_total_amount CHECK (total_amount >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id bigint NOT NULL AUTO_INCREMENT,
        booking_id bigint NOT NULL,
        amount decimal(12,2) NOT NULL,
        method varchar(30) NOT NULL,
        status enum('PENDING','SUCCESS','FAILED','REFUNDED')
          NOT NULL DEFAULT 'PENDING',
        gateway_name varchar(80) DEFAULT NULL,
        gateway_transaction_id varchar(160) DEFAULT NULL,
        paid_at datetime DEFAULT NULL,
        created_at datetime NOT NULL DEFAULT (now()),
        PRIMARY KEY (id),
        UNIQUE KEY uq_payments_gateway_transaction (gateway_transaction_id),
        KEY idx_payments_booking (booking_id),
        KEY idx_payments_status (status),
        CONSTRAINT payments_ibfk_1
          FOREIGN KEY (booking_id) REFERENCES bookings (id),
        CONSTRAINT chk_payments_amount CHECK (amount > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS room_calendar (
        id bigint NOT NULL AUTO_INCREMENT,
        room_id bigint NOT NULL,
        booking_id bigint DEFAULT NULL,
        stay_date date NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'RESERVED',
        reason varchar(500) DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_room_calendar_room_date (room_id, stay_date),
        KEY idx_room_calendar_booking (booking_id),
        KEY idx_room_calendar_date (stay_date),
        KEY idx_room_calendar_status (status),
        CONSTRAINT fk_room_calendar_booking
          FOREIGN KEY (booking_id) REFERENCES bookings (id),
        CONSTRAINT room_calendar_ibfk_1
          FOREIGN KEY (room_id) REFERENCES rooms (id),
        CONSTRAINT chk_room_calendar_booking_required
          CHECK (status <> 'RESERVED' OR booking_id IS NOT NULL)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'The initial schema baseline cannot be reverted safely. Restore from a database backup instead.',
      ),
    );
  }
}
