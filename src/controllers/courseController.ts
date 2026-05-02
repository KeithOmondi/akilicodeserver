import { Request, Response } from 'express';
import pool from '../config/db'; // Your Postgres/ElephantSQL pool

export const createCourse = async (req: Request, res: Response) => {
    try {
        const { title, description, price, duration, category, image_url } = req.body;
        const newCourse = await pool.query(
            "INSERT INTO courses (title, description, price, duration, category, image_url) VALUES($1, $2, $3, $4, $5, $6) RETURNING *",
            [title, description, price, duration, category, image_url]
        );
        res.status(201).json({ status: 'success', data: { course: newCourse.rows[0] } });
    } catch (err: any) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

export const getAllCourses = async (req: Request, res: Response) => {
    try {
        const courses = await pool.query("SELECT * FROM courses ORDER BY created_at DESC");
        res.status(200).json({
            status: 'success',
            results: courses.rows.length,
            data: { courses: courses.rows }
        });
    } catch (err: any) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};