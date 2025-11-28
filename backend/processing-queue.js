/**
 * Simple in-memory job queue to process tasks sequentially
 * Used to limit concurrency of resource-intensive operations like image resizing
 */
class ProcessingQueue {
    constructor(concurrency = 1) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    /**
     * Add a task to the queue
     * @param {Function} task - Async function to execute
     * @returns {Promise} - Resolves when task completes
     */
    add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processNext();
        });
    }

    /**
     * Process next task in queue if concurrency limit allows
     */
    async processNext() {
        if (this.running >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.running++;
        const { task, resolve, reject } = this.queue.shift();

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.running--;
            this.processNext();
        }
    }

    /**
     * Get current queue status
     */
    getStats() {
        return {
            running: this.running,
            queued: this.queue.length
        };
    }
}

module.exports = ProcessingQueue;
