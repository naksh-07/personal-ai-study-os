import {
  Subject,
  Chapter,
  StudyProgress,
  TaskLink,
  ResolvedWorkload,
  WorkloadResolution,
} from '@personal-os/domain';

export interface WorkloadResolverInput {
  subjects: Subject[];
  chapters?: Chapter[];
  progress?: StudyProgress[];
  taskLinks?: TaskLink[];
}

/**
 * Deterministic Workload Resolver for Personal AI Study OS.
 *
 * Implements the approved Adaptive Workload Resolution hierarchy:
 *   LEVEL 4: Specific Task       -> Subject / Chapter / Topic / Task
 *   LEVEL 3: Subject + Topic     -> Subject / Chapter / Topic
 *   LEVEL 2: Subject + Chapter   -> Subject / Chapter
 *   LEVEL 1: Subject only        -> Subject
 *   LEVEL 0: No study intent     -> []
 *
 * Global Invariant:
 *   LEVEL 4 > LEVEL 3 > LEVEL 2 > LEVEL 1 > LEVEL 0
 *   - Use the highest-resolution information that actually exists.
 *   - Never require a higher-resolution input.
 *   - Never invent missing subjects, chapters, topics, or tasks.
 *   - Resolve each subject independently.
 */
export class WorkloadResolver {
  static resolveWorkloads(input: WorkloadResolverInput): ResolvedWorkload[] {
    const subjects = (input.subjects ?? []).filter(s => s.status === 'active');
    const chapters = input.chapters ?? [];
    const progress = input.progress ?? [];
    const taskLinks = (input.taskLinks ?? []).filter(
      t => t.statusSnapshot === 'needsAction' || !t.statusSnapshot
    );

    // LEVEL 0: If no active subjects and no study tasks exist, return empty
    if (subjects.length === 0) {
      return [];
    }

    const resolved: ResolvedWorkload[] = [];

    for (const subject of subjects) {
      const subjectWorkloads: ResolvedWorkload[] = [];
      const subjectChapters = chapters.filter(c => c.subjectId === subject.id);
      const activeChapters = subjectChapters.filter(c => c.status !== 'completed');

      // Partition active chapters into parent chapters and child chapters (topics)
      const parentChapters = activeChapters.filter(c => !c.parentId);
      const topicChapters = activeChapters.filter(c => Boolean(c.parentId));

      // Track which chapters/topics have tasks assigned
      const chaptersWithTasks = new Set<string>();

      // 1. Check for Level 4 (Tasks) linked to this subject or its chapters/topics
      for (const t of taskLinks) {
        const title = t.titleSnapshot ?? `Task ${t.taskId}`;

        // Check if task is linked to a topic (child chapter)
        if (t.entityType === 'chapter' || t.entityType === 'topic') {
          const matchingTopic = topicChapters.find(tc => tc.id === t.entityId);
          if (matchingTopic) {
            chaptersWithTasks.add(matchingTopic.id);
            const parent = subjectChapters.find(p => p.id === matchingTopic.parentId);
            const displayName = parent
              ? `${subject.name} / ${parent.name} / ${matchingTopic.name} / ${title}`
              : `${subject.name} / ${matchingTopic.name} / ${title}`;

            subjectWorkloads.push({
              resolution: 'task',
              subjectId: subject.id,
              subjectName: subject.name,
              chapterId: parent?.id ?? matchingTopic.id,
              chapterName: parent?.name,
              topicId: matchingTopic.id,
              topicName: matchingTopic.name,
              taskId: t.taskId,
              taskTitle: title,
              status: t.statusSnapshot ?? 'needsAction',
              progressPercent: 0.0,
              displayName,
            });
            continue;
          }

          // Check if task is linked to a parent/standalone chapter
          const matchingParent = parentChapters.find(pc => pc.id === t.entityId);
          if (matchingParent) {
            chaptersWithTasks.add(matchingParent.id);
            subjectWorkloads.push({
              resolution: 'task',
              subjectId: subject.id,
              subjectName: subject.name,
              chapterId: matchingParent.id,
              chapterName: matchingParent.name,
              taskId: t.taskId,
              taskTitle: title,
              status: t.statusSnapshot ?? 'needsAction',
              progressPercent: 0.0,
              displayName: `${subject.name} / ${matchingParent.name} / ${title}`,
            });
            continue;
          }
        }

        // Check if task is linked directly to the subject
        if (t.entityType === 'subject' && t.entityId === subject.id) {
          subjectWorkloads.push({
            resolution: 'task',
            subjectId: subject.id,
            subjectName: subject.name,
            taskId: t.taskId,
            taskTitle: title,
            status: t.statusSnapshot ?? 'needsAction',
            progressPercent: 0.0,
            displayName: `${subject.name} / ${title}`,
          });
        }
      }

      // 2. Check for Level 3 (Topics) without tasks
      for (const topic of topicChapters) {
        if (!chaptersWithTasks.has(topic.id)) {
          const parent = subjectChapters.find(p => p.id === topic.parentId);
          const prog = progress.find(p => p.chapterId === topic.id);
          const displayName = parent
            ? `${subject.name} / ${parent.name} / ${topic.name}`
            : `${subject.name} / ${topic.name}`;

          subjectWorkloads.push({
            resolution: 'topic',
            subjectId: subject.id,
            subjectName: subject.name,
            chapterId: parent?.id ?? topic.id,
            chapterName: parent?.name,
            topicId: topic.id,
            topicName: topic.name,
            status: topic.status,
            progressPercent: prog?.progressPercent ?? topic.progress ?? 0.0,
            displayName,
          });
        }
      }

      // 3. Check for Level 2 (Chapters) without child topics and without tasks
      for (const chapter of parentChapters) {
        // If this chapter has child topics in the curriculum, those were already handled or exist
        const hasChildTopics = topicChapters.some(tc => tc.parentId === chapter.id);
        if (!hasChildTopics && !chaptersWithTasks.has(chapter.id)) {
          const prog = progress.find(p => p.chapterId === chapter.id);
          subjectWorkloads.push({
            resolution: 'chapter',
            subjectId: subject.id,
            subjectName: subject.name,
            chapterId: chapter.id,
            chapterName: chapter.name,
            status: chapter.status,
            progressPercent: prog?.progressPercent ?? chapter.progress ?? 0.0,
            displayName: `${subject.name} / ${chapter.name}`,
          });
        }
      }

      // 4. If no higher-level workloads exist for this subject, resolve at Level 1 (Subject only)
      if (subjectWorkloads.length === 0) {
        subjectWorkloads.push({
          resolution: 'subject',
          subjectId: subject.id,
          subjectName: subject.name,
          status: 'not_started',
          progressPercent: 0.0,
          displayName: subject.name,
        });
      }

      resolved.push(...subjectWorkloads);
    }

    return resolved;
  }

  /**
   * Resolves the canonical resolution category for a study session mutation.
   */
  static deriveSessionResolution(input: {
    resolution?: WorkloadResolution;
    taskId?: string | null;
    topicId?: string | null;
    chapterId?: string | null;
  }): WorkloadResolution {
    if (input.resolution) {
      return input.resolution;
    }
    if (input.taskId) {
      return 'task';
    }
    if (input.topicId) {
      return 'topic';
    }
    if (input.chapterId) {
      return 'chapter';
    }
    return 'subject';
  }
}
